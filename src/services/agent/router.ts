import type { PrismaClient } from '@prisma/client'
import type { Intent } from './intents.js'
import { TransactionAnalyticsService } from '../analytics/analytics.js'
import { extractQueryContext } from '../analytics/context.js'
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

  if (intent === 'unknown') return STATIC_UNKNOWN

  // ── Data-driven intents ─────────────────────────────────────────────────
  if (!(await analytics.hasActiveBankConnection(userId))) {
    return buildConnectLink(prisma, userId)
  }

  const { fromDate, toDate, categoryFilter } = extractQueryContext(message)

  let structuredText: string

  switch (intent) {
    case 'spending_analysis': {
      if (isSpendingPersonalityRequest(message)) {
        structuredText = await getSpendingPersonality(prisma, userId)
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
      // Conversational AI fallback — answers anything using full financial context
      if (anthropicApiKey) {
        const snapshot = await analytics.getFinancialSnapshot(userId)
        const aiAnswer = await answerWithAI(message, snapshot, anthropicApiKey, history)
        if (aiAnswer) return aiAnswer
      }
      return STATIC_UNKNOWN
    }
  }

  if (anthropicApiKey) {
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
