import type { PrismaClient } from '@prisma/client'
import type { Intent } from './intents.js'
import { TransactionAnalyticsService } from '../analytics/analytics.js'
import { extractQueryContext, extractSpendSubject, extractEarnSubject } from '../analytics/context.js'
import { refreshUserData } from '../sync/refreshService.js'
import {
  formatSpendingAnalysis,
  formatSubscriptions,
  formatUnusualSpending,
  formatAccountBalances,
  formatAffordability,
  formatSafeToSpend,
  formatMerchantSpend,
  formatIncomeQuery,
  formatSavingsQuery,
  formatUpcomingBills,
  polishWithLlm,
} from '../analytics/formatter.js'
import { answerWithAI } from './conversational.js'
import { answerWithAgent } from './agenticHandler.js'
import { parseGoalFromMessage, createGoal, listGoals } from '../savings/savingsGoalService.js'
import { handleAccountManagement } from '../account/accountManagementService.js'
import { handleBudget } from '../budget/budgetService.js'
import { calculateNetWorth, formatNetWorth } from '../analytics/netWorthService.js'
import { getSpendingTrends, formatSpendingTrends } from '../analytics/spendingTrendService.js'
import { getSpendingForecast, formatSpendingForecast } from '../analytics/spendingForecastService.js'
import { getFinancialHealthScore, formatFinancialHealthScore } from '../analytics/financialHealthService.js'
import { parseTransactionSearch, searchTransactions, formatTransactionSearch } from '../analytics/transactionSearchService.js'
import { getCashFlowForecast, formatCashFlowForecast } from '../analytics/cashFlowService.js'
import { getTaxYearSummary, formatTaxYearSummary } from '../analytics/taxYearService.js'
import { detectDuplicateTransactions, formatDuplicateTransactions } from '../analytics/duplicateTransactionService.js'
import { getMerchantInsight, formatMerchantInsight } from '../analytics/merchantInsightService.js'
import { parseSimulation, runSavingsSimulation, formatSimulationResult } from '../savings/savingsSimulationService.js'
import { getFxTransactions, formatFxSummary } from '../analytics/fxTransactionService.js'
import { getCharitySummary, formatCharitySummary } from '../analytics/charityTrackerService.js'
import { getCategoryDeepDive, formatCategoryDeepDive } from '../analytics/categoryDeepDiveService.js'
import { getCreditHealthReport, formatCreditHealthReport } from '../analytics/creditHealthService.js'
import { handleSpendDown } from '../savings/spendDownService.js'
import { getSavingsRecommendations, isSavingsRecommendationRequest } from '../savings/savingsRecommendationService.js'
import { getUpcomingBills, isBillCalendarRequest } from '../bills/billCalendarService.js'
import { parseCreditSimulation, simulateCreditImpact, isCreditSimulationRequest } from '../analytics/creditSimulationService.js'
import { checkSwitchingOpportunity, isSwitchingRequest, extractSwitchingCategory } from '../switching/switchingDetectorService.js'
import { getEmergencyFundStatus, isEmergencyFundRequest } from '../analytics/emergencyFundService.js'
import { getSpendingPersonality, isSpendingPersonalityRequest } from '../analytics/spendingPersonalityService.js'
import { suggestFinancialGoals, isGoalSuggestionRequest } from '../savings/goalSuggestionService.js'
import { estimateTax, isTaxEstimatorRequest } from '../analytics/taxEstimatorService.js'
import { recommendRewardCard, isRewardCardRequest } from '../analytics/rewardCardService.js'
import { checkPensionContributions, isPensionRequest } from '../analytics/pensionCheckerService.js'
import { calculatePropertyAffordability, isPropertyAffordabilityRequest } from '../analytics/propertyAffordabilityService.js'
import type { HistoryMessage } from '../conversation/sessionService.js'
import { generateOnboardingToken } from '../onboarding/token.js'
import { logConsentEvent } from '../onboarding/audit.js'
import { trackEvent } from '../analytics/events.js'
import { validateAndFormatResponse } from './responseValidator.js'
import { config } from '../../config.js'

export const PAYMENT_REJECTION =
  `Payments aren't available yet — that's coming soon. Right now I can help you understand your money: spending, balances, subscriptions, and whether you can afford something.`

// ── Bank connection link ───────────────────────────────────────────────────

/** True if the message explicitly requests a bank connection. */
const CONNECT_BANK_PATTERNS = [
  /connect\s+(my\s+)?(bank|account)/i,
  /link\s+(my\s+)?(bank|account)/i,
  /add\s+(my\s+)?(bank|account)/i,
  /set\s+up\s+(my\s+)?(bank|account)/i,
  /get\s+started/i,
]

function isConnectBankRequest(message: string): boolean {
  return CONNECT_BANK_PATTERNS.some((p) => p.test(message))
}

/**
 * Generates a one-time onboarding token, logs the event, and returns a
 * WhatsApp-ready message containing the consent link.
 */
async function buildConnectLink(prisma: PrismaClient, userId: string): Promise<string> {
  const token = await generateOnboardingToken(prisma, userId)
  const link = `${config.APP_BASE_URL}/banking/start?token=${token}`
  await logConsentEvent(prisma, 'bank_connect_link_sent', userId, { link })
  return (
    `To connect your bank, tap this link — it expires in 15 minutes:\n${link}\n\n` +
    `Once connected, I'll import your last 90 days of transactions automatically.`
  )
}

// ── Static responses ───────────────────────────────────────────────────────

const STATIC_ONBOARDING =
  "Welcome to Monika! I'm your AI-powered UK finance assistant. Ask me about your spending, subscriptions, balance, or whether you can afford something. To get started, say \"connect my bank\"."

/**
 * Does this message ask Monika to pull fresh data from the bank now?
 * "refresh", "update my account", "sync my data", "up to date", "check now"…
 */
export function isRefreshRequest(message: string): boolean {
  const m = message.trim().toLowerCase()
  return (
    /\brefresh\b|\bre-?sync\b|\bresync\b/.test(m) ||
    /\b(update|updated|sync|pull|reload|refetch)\s+(my\s+)?(account|accounts|data|balance|balances|transactions?|info)\b/.test(m) ||
    /\b(up\s*to\s*date|latest)\s+(account|accounts|data|balance|balances|info|transactions?)\b/.test(m) ||
    /\b(get|pull|fetch)\s+(the\s+)?latest\b/.test(m) ||
    /\bcheck\s+(now|again|for\s+new)\b/.test(m)
  )
}

const fmtGbp = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Deterministic merchant-spend answer for "how much did I spend on <merchant>".
 * Finds the merchant's transactions and lists them with a total. If several
 * distinct merchant names match, it asks which (numbered). No LLM, no "shall
 * I dig in?" — the user asked, so we answer.
 */
async function handleMerchantSpend(
  prisma: PrismaClient,
  userId: string,
  subject: string,
  message: string,
  isCategory: boolean,
): Promise<string | null> {
  const analytics = new TransactionAnalyticsService(prisma)
  const hasTimeframe = /today|yesterday|this\s+(week|month|year)|last\s+(week|month|year|\d+)|financial\s+year|\b\d{4}\b/i.test(message)
  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const { fromDate, toDate } = hasTimeframe
    ? extractQueryContext(message)
    : { fromDate: yearStart, toDate: now }

  // Always try the merchant first — even for words that double as categories
  // (uber→transport, tesco→groceries), the user named a specific thing.
  const merchants = await analytics.findMerchants(userId, subject, fromDate, toDate)

  if (merchants.length === 0) {
    // Nothing in the asked window. Widen to this year so we can say where the
    // spending actually is, rather than a flat "couldn't find".
    if (hasTimeframe) {
      const wider = await analytics.findMerchants(userId, subject, yearStart, now)
      if (wider.length > 0) {
        const widerTotal = wider.reduce((s, m) => s + m.total, 0)
        const names = wider.length === 1 ? `*${wider[0]!.merchant}*` : `${wider.length} matching merchants`
        return `Nothing for *${subject}* in that period. But you've spent *${fmtGbp(widerTotal)}* at ${names} so far this year — want the breakdown?`
      }
    }
    // A pure category word with no merchant match → let the category handler run.
    if (isCategory) return null
    return `I couldn't find any transactions for *${subject}*. Try the name exactly as it appears on your statement.`
  }

  // Several genuinely different merchant names → ask which one.
  if (merchants.length > 1) {
    let out = `I found a few that match *${subject}* — which did you mean?\n\n`
    merchants.slice(0, 5).forEach((m, i) => {
      out += `${i + 1}) *${m.merchant}* — ${fmtGbp(m.total)} (${m.transactionCount} payment${m.transactionCount === 1 ? '' : 's'})\n`
    })
    out += `\nReply with the number or the name.`
    return out
  }

  // One merchant → list its transactions with a total.
  const only = merchants[0]!
  const detail = await analytics.getSpendingByMerchantName(userId, only.merchant, fromDate, toDate)
  let out = `Here's what I found for *${only.merchant}*:\n\n`
  for (const t of detail.transactions.slice(0, 15)) {
    out += `• ${t.date} — ${t.merchant}: *${fmtGbp(t.amount)}*\n`
  }
  if (detail.transactions.length > 15) out += `…and ${detail.transactions.length - 15} more.\n`
  out += `\n*Total: ${fmtGbp(detail.total)}* across ${detail.transactionCount} payment${detail.transactionCount === 1 ? '' : 's'}`
  return out
}

/**
 * Deterministic answer for "how much do I earn/receive from <payer>".
 * Sums the credits coming in from that payer and lists them.
 */
async function handlePayerIncome(
  prisma: PrismaClient,
  userId: string,
  payer: string,
  message: string,
): Promise<string> {
  const analytics = new TransactionAnalyticsService(prisma)
  const hasTimeframe = /today|yesterday|this\s+(week|month|year)|last\s+(week|month|year|\d+)|financial\s+year|\b\d{4}\b/i.test(message)
  const { fromDate, toDate } = hasTimeframe
    ? extractQueryContext(message)
    : { fromDate: new Date(new Date().getFullYear(), 0, 1), toDate: new Date() }

  const r = await analytics.getIncomeFromPayer(userId, payer, fromDate, toDate)
  if (r.transactionCount === 0) {
    return `I can't see any money coming in from *${payer}* in that period. If the income lands in an account you haven't connected, I won't see it — or try the name exactly as it appears on your statement.`
  }
  let out = `You've received *${fmtGbp(r.total)}* from *${payer}* across ${r.transactionCount} payment${r.transactionCount === 1 ? '' : 's'}:\n\n`
  for (const t of r.transactions.slice(0, 12)) {
    out += `• ${t.date}: *${fmtGbp(t.amount)}*\n`
  }
  if (r.transactions.length > 12) out += `…and ${r.transactions.length - 12} more.\n`
  return out.trim()
}

/**
 * Heuristic: does this message read as a follow-up to the previous turn rather
 * than a self-contained request? Follow-ups start with a connective ("and…",
 * "what about…") or are a short fragment that only makes sense with context
 * ("last month?", "and at Tesco?"). Such messages are routed to the agent,
 * which has the conversation history and can resolve the reference.
 */
export function isFollowUp(message: string): boolean {
  const m = message.trim().toLowerCase().replace(/[?.!]+$/g, '')
  // Explicit follow-up connectives.
  if (/^(and\b|but\b|also\b|what about\b|how about\b|what of\b|what if\b|ok,?\s+(what|how)\s+about\b|and\s+(for|the|at|in|on|to|about)\b|same for\b|compared? to\b)/.test(m)) {
    return true
  }
  // Short fragments that lean on prior context (a bare timeframe / "that one").
  const words = m.split(/\s+/).filter(Boolean)
  if (
    words.length <= 4 &&
    /\b(last|this|next|previous|yesterday|today|tomorrow|month|week|year|weekend|them|those|that|it|more|again|instead)\b/.test(m) &&
    !/\b(balance|connect|link|help|afford|mortgage)\b/.test(m)
  ) {
    return true
  }
  // Short interrogatives that refer back to the previous answer:
  // "what subscription?", "which merchant?", "what was it?", "which one?",
  // "what for?", "how many?". These only make sense with the prior turn.
  if (
    words.length <= 4 &&
    /^(what|which|who|whom|whose|where|why|when|how\s+(many|much|come))\b/.test(m) &&
    !/\b(balance|afford|mortgage|credit|net\s*worth|financial\s+health)\b/.test(m) &&
    !/^how\s+much\s+(did|have|do|can|is|are)\b/.test(m)
  ) {
    return true
  }
  return false
}

const STATIC_UNKNOWN =
  "I didn't quite understand that. You can ask me things like: \"How much did I spend on groceries?\", \"Can I afford a £400k mortgage?\", \"How much can I safely spend this weekend?\", or \"What's my balance?\""

// ── Main router ────────────────────────────────────────────────────────────

export async function routeIntent(
  intent: Intent,
  message: string,
  userId: string,
  prisma: PrismaClient,
  anthropicApiKey = '',
  history: HistoryMessage[] = [],
): Promise<string> {
  // Payment requests — not yet supported
  if (intent === 'payment_request') return PAYMENT_REJECTION

  // Account management — works without bank connection
  if (intent === 'account_management') {
    return handleAccountManagement(prisma, userId, message)
  }

  // Budget management — works without bank connection (budgets stored in auditLog)
  if (intent === 'budget') {
    return handleBudget(prisma, userId, message)
  }

  // Spend-down / debt payoff goals — works without bank connection
  if (intent === 'spend_down') {
    return handleSpendDown(prisma, userId, message)
  }

  // Savings goals — handled before bank check (listing works without bank)
  if (intent === 'savings_goal') {
    if (isGoalSuggestionRequest(message)) {
      return suggestFinancialGoals(prisma, userId)
    }
    if (/my\s+savings?\s+goals?|how\s+am\s+i\s+doing/i.test(message)) {
      return listGoals(prisma, userId)
    }
    const parsed = parseGoalFromMessage(message)
    if (!parsed) {
      return `To set a savings goal, try: *"I want to save £2,000 for a holiday by December"* or *"Save £500/month for a car"*.`
    }
    return createGoal(prisma, userId, parsed)
  }

  const analytics = new TransactionAnalyticsService(prisma)

  // ── onboarding_help ────────────────────────────────────────────────────
  if (intent === 'onboarding_help') {
    if (isConnectBankRequest(message)) {
      const alreadyConnected = await analytics.hasActiveBankConnection(userId)
      if (alreadyConnected) {
        return "Your bank is already connected. You can ask me about your spending, subscriptions, balance, or whether you can afford something."
      }
      return buildConnectLink(prisma, userId)
    }
    return STATIC_ONBOARDING
  }

  // On-demand refresh: pull the latest data from the bank now, so a recent
  // withdrawal/payment shows up without waiting for the scheduled sync.
  if (isRefreshRequest(message)) {
    const result = await refreshUserData(prisma, userId)
    if (result.connections === 0) {
      return buildConnectLink(prisma, userId)
    }
    const balances = await analytics.getAccountBalances(userId)
    const total = balances.reduce((s, b) => s + b.currentBalance, 0)
    return (
      `🔄 *Updated.* I've pulled the latest from your bank.\n\n` +
      `*Current balance:* ${fmtGbp(total)}\n\n` +
      `Ask me anything — your data's now up to date.`
    )
  }

  // ── Data-driven intents ─────────────────────────────────────────────────
  // Note: 'unknown' is no longer a dead end — it falls through to the agentic
  // handler in the default case, which can answer almost any data question.
  if (!(await analytics.hasActiveBankConnection(userId))) {
    // Without a bank connection there's no data to reason over. For a genuinely
    // unrecognised message, show the help text; otherwise prompt to connect.
    if (intent === 'unknown') return STATIC_UNKNOWN
    return buildConnectLink(prisma, userId)
  }

  // Conversational follow-ups ("what about last month?", "and Tesco?") depend on
  // the previous turns. The structured handlers are single-shot and context-blind,
  // so route follow-ups to the agent, which carries the conversation + tools.
  if (anthropicApiKey && history.length > 0 && isFollowUp(message)) {
    const followUp = await answerWithAgent(message, userId, prisma, anthropicApiKey, history)
    if (followUp) return followUp
    // fall through to normal handling if the agent is unavailable
  }

  // "how much do I earn from <X>": sum the money coming IN from that payer,
  // instead of guessing at a salary flag.
  const earnSubject = extractEarnSubject(message)
  if (earnSubject) {
    return handlePayerIncome(prisma, userId, earnSubject, message)
  }

  // "how much did I spend on <X>": try the merchant first (even for words that
  // double as categories, like "uber"), list the transactions, and widen the
  // window if the asked period is empty. Falls through to the category handler
  // only for a pure category word with no merchant match.
  const spendSubject = extractSpendSubject(message)
  if (spendSubject) {
    const merchantAnswer = await handleMerchantSpend(prisma, userId, spendSubject.subject, message, spendSubject.isCategory)
    if (merchantAnswer) return merchantAnswer
  }

  const { fromDate, toDate, categoryFilter } = extractQueryContext(message)

  let structuredText: string

  switch (intent) {
    case 'spending_analysis': {
      if (isSpendingPersonalityRequest(message)) {
        structuredText = await getSpendingPersonality(prisma, userId)
        break
      }
      if (isRewardCardRequest(message)) {
        const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
        const cats = await prisma.transaction.groupBy({
          by: ['category'],
          where: { userId, amount: { gt: 0 }, transactionDate: { gte: threeMonthsAgo } },
          _sum: { amount: true },
        })
        const spendInput = cats.map(c => ({
          category: (c.category ?? 'other').toLowerCase(),
          monthly: Number((c._sum as { amount?: unknown }).amount ?? 0) / 3,
        }))
        structuredText = recommendRewardCard(spendInput)
        break
      }
      const [categories, comparison] = await Promise.all([
        analytics.getSpendingByCategory(userId, fromDate, toDate, categoryFilter),
        analytics.getMonthlyComparison(userId, categoryFilter),
      ])
      structuredText = formatSpendingAnalysis(categories, comparison, categoryFilter, fromDate)
      break
    }

    case 'subscription_detection': {
      if (isSwitchingRequest(message)) {
        const cat = extractSwitchingCategory(message)
        structuredText = await checkSwitchingOpportunity(prisma, userId, cat)
      } else {
        const subscriptions = await analytics.getSubscriptions(userId)
        structuredText = formatSubscriptions(subscriptions)
      }
      break
    }

    case 'unusual_spending': {
      const unusualFrom = new Date(Date.now() - 30 * 86_400_000)
      const transactions = await analytics.getUnusualSpending(userId, unusualFrom, new Date())
      structuredText = formatUnusualSpending(transactions)
      break
    }

    case 'account_balance': {
      const balances = await analytics.getAccountBalances(userId)
      structuredText = formatAccountBalances(balances)
      break
    }

    case 'affordability_question': {
      if (isPropertyAffordabilityRequest(message)) {
        structuredText = await calculatePropertyAffordability(prisma, userId, message)
        break
      }
      const profile = await analytics.getAffordabilityProfile(userId)
      structuredText = formatAffordability(profile, message)
      break
    }

    case 'safe_to_spend': {
      const days = /week\b/i.test(message) && !/weekend/i.test(message) ? 7 : /month/i.test(message) ? 30 : 3
      const data = await analytics.getSafeToSpend(userId, days)
      structuredText = formatSafeToSpend(data)
      break
    }

    case 'merchant_query': {
      const { fromDate: mFrom, toDate: mTo, merchantFilter } = extractQueryContext(message)
      // Extract merchant from message if not caught by patterns
      const merchant = merchantFilter ?? message.match(/(?:at|on|from)\s+([A-Za-z0-9 &]+?)(?:\?|$|\s+in|\s+last|\s+this)/i)?.[1]?.trim()
      if (!merchant) {
        structuredText = "Which merchant would you like to check? For example: \"How much have I spent at Tesco this month?\""
      } else if (!mFrom && !mTo && /insight|history|detail|tell me about|how often|visits?/i.test(message)) {
        // Enriched merchant insight when no date filter and user wants historical context
        const insight = await getMerchantInsight(prisma, userId, merchant)
        structuredText = insight
          ? formatMerchantInsight(insight)
          : `No transactions found for *${merchant}*.`
      } else {
        const result = await analytics.getSpendingByMerchantName(userId, merchant, mFrom, mTo)
        structuredText = formatMerchantSpend(merchant, result, mFrom)
      }
      break
    }

    case 'income_query': {
      const profile = await analytics.getAffordabilityProfile(userId)
      // Detect last salary date
      const lastSalary = await analytics['prisma'].transaction.findFirst({
        where: { userId, isSalary: true, amount: { gt: 0 } },
        orderBy: { transactionDate: 'desc' },
        select: { transactionDate: true },
      })
      const lastDate = lastSalary?.transactionDate ?? null
      // Estimate next payday: same day next month
      const nextDate = lastDate
        ? new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, lastDate.getDate())
        : null
      structuredText = formatIncomeQuery(profile.monthlyIncome, lastDate, nextDate)
      break
    }

    case 'savings_query': {
      if (isEmergencyFundRequest(message)) {
        structuredText = await getEmergencyFundStatus(prisma, userId)
        break
      }
      if (isSavingsRecommendationRequest(message)) {
        return getSavingsRecommendations(prisma, userId)
      }
      const [profile, snap] = await Promise.all([
        analytics.getAffordabilityProfile(userId),
        analytics.getFinancialSnapshot(userId),
      ])
      structuredText = formatSavingsQuery(profile.monthlyIncome, snap.thisMonthSpend, snap.savingsRate)
      break
    }

    case 'upcoming_bills': {
      if (isBillCalendarRequest(message)) {
        structuredText = await getUpcomingBills(prisma, userId)
      } else {
        const subscriptions = await analytics.getSubscriptions(userId)
        structuredText = formatUpcomingBills(subscriptions, 0)
      }
      break
    }

    case 'net_worth': {
      const breakdown = await calculateNetWorth(prisma, userId)
      structuredText = formatNetWorth(breakdown)
      break
    }

    case 'spending_trends': {
      const trendResult = await getSpendingTrends(prisma, userId)
      structuredText = formatSpendingTrends(trendResult)
      break
    }

    case 'spending_forecast': {
      const forecast = await getSpendingForecast(prisma, userId)
      structuredText = formatSpendingForecast(forecast)
      break
    }

    case 'financial_health': {
      if (isPensionRequest(message)) {
        structuredText = await checkPensionContributions(prisma, userId, message)
        break
      }
      const healthScore = await getFinancialHealthScore(prisma, userId)
      structuredText = formatFinancialHealthScore(healthScore)
      break
    }

    case 'credit_health': {
      if (isCreditSimulationRequest(message)) {
        const scenario = parseCreditSimulation(message) ?? { type: 'generic' as const }
        structuredText = await simulateCreditImpact(prisma, userId, scenario)
      } else {
        const creditReport = await getCreditHealthReport(prisma, userId)
        structuredText = formatCreditHealthReport(creditReport)
      }
      break
    }

    case 'fx_transactions': {
      const fxSummary = await getFxTransactions(prisma, userId)
      structuredText = formatFxSummary(fxSummary)
      break
    }

    case 'charity_tracker': {
      const charitySummary = await getCharitySummary(prisma, userId)
      structuredText = formatCharitySummary(charitySummary)
      break
    }

    case 'category_deep_dive': {
      // Extract category from message
      const catMatch = message.match(
        /(?:breakdown\s+(?:of|for)|detailed?\s+(?:spending|breakdown)\s+(?:on|for)|more\s+details?\s+(?:on|about)\s+my|drill\s+down\s+(?:into|on)|deep\s+dive\s+(?:into|on))\s+(?:my\s+)?([\w\s]+?)(?:\s+spending|\s*\?|$)/i,
      )
      const cat = catMatch?.[1]?.trim() ?? categoryFilter
      if (!cat) {
        structuredText = `Which category would you like a breakdown for? E.g. *"breakdown of my groceries"* or *"detail on eating out"*.`
      } else {
        const deepDive = await getCategoryDeepDive(prisma, userId, cat)
        structuredText = formatCategoryDeepDive(deepDive)
      }
      break
    }

    case 'savings_simulation': {
      const simInput = parseSimulation(message)
      if (!simInput) {
        structuredText = `Try: *"If I save £200/month, how long to reach my holiday goal?"* or *"If I cut eating out by £50, when do I hit £2,000?"*`
      } else {
        const simResult = await runSavingsSimulation(prisma, userId, simInput)
        structuredText = formatSimulationResult(simResult)
      }
      break
    }

    case 'duplicate_detection': {
      const dupes = await detectDuplicateTransactions(prisma, userId)
      structuredText = formatDuplicateTransactions(dupes)
      break
    }

    case 'tax_year_summary': {
      if (isTaxEstimatorRequest(message)) {
        structuredText = await estimateTax(prisma, userId)
        break
      }
      const taxSummary = await getTaxYearSummary(prisma, userId)
      structuredText = formatTaxYearSummary(taxSummary)
      break
    }

    case 'cash_flow': {
      const forecast = await getCashFlowForecast(prisma, userId)
      structuredText = formatCashFlowForecast(forecast)
      break
    }

    case 'transaction_search': {
      const filters = parseTransactionSearch(message)
      if (!filters) {
        structuredText = `What would you like to search for? Try: *"Show me transactions at Tesco last month"* or *"Find purchases over £50 this month"*.`
      } else {
        const results = await searchTransactions(prisma, userId, filters)
        structuredText = formatTransactionSearch(results, filters)
      }
      break
    }

    default: {
      // Agentic fallback — Claude calls live data tools to answer almost anything
      // ("spending at Costa last Tuesday?", "biggest expense this year?", etc.).
      if (anthropicApiKey) {
        const agentAnswer = await answerWithAgent(message, userId, prisma, anthropicApiKey, history)
        if (agentAnswer) return agentAnswer
        // Fall back to the lighter snapshot handler if the agent is unavailable.
        const snapshot = await analytics.getFinancialSnapshot(userId)
        const aiAnswer = await answerWithAI(message, snapshot, anthropicApiKey, history)
        if (aiAnswer) return aiAnswer
      }
      return STATIC_UNKNOWN
    }
  }

  // Intents whose output is an itemised list/table we want to show verbatim —
  // LLM polishing would collapse the list into prose, so skip it for these.
  const NO_POLISH_INTENTS = new Set<Intent>(['transaction_search', 'upcoming_bills'])

  if (anthropicApiKey && !NO_POLISH_INTENTS.has(intent)) {
    const polished = await polishWithLlm(intent, structuredText, message, anthropicApiKey)
    // polishWithLlm returns structuredText unchanged on LLM failure — detect and track
    if (polished === structuredText) {
      trackEvent(prisma, 'ai_error', userId, { intent, reason: 'llm_fallback' }).catch(() => undefined)
    }
    const { text } = validateAndFormatResponse(polished, { toolsUsed: [intent] })
    return text
  }

  const { text } = validateAndFormatResponse(structuredText, { toolsUsed: [intent] })
  return text
}
