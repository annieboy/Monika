/**
 * Agentic financial assistant.
 *
 * Instead of mapping each question to a hand-coded handler, this gives Claude a
 * set of data tools (balances, spending, transaction search, subscriptions,
 * income, …) and lets it decide which to call to answer an arbitrary question.
 * This is what lets Monika handle the long tail: "how much did I spend at Costa
 * last Tuesday?", "what's my biggest expense this year?", "am I spending more on
 * takeaways than last month?", etc.
 *
 * Read-only: every tool only reads the user's data. The model cannot move money.
 */
import type { PrismaClient } from '@prisma/client'
import { TransactionAnalyticsService } from '../analytics/analytics.js'
import { getUpcomingBills } from '../bills/billCalendarService.js'
import { getCharitySummary } from '../analytics/charityTrackerService.js'
import { calculateNetWorth } from '../analytics/netWorthService.js'
import type { HistoryMessage } from '../conversation/sessionService.js'
import { allowAgentCall } from './rateLimiter.js'
import { logger } from '../../logger.js'

const RATE_LIMIT_MESSAGE =
  "You're asking a lot in a short burst — give me a minute to catch up, then try again. 🙂"

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOOL_ITERATIONS = 6

type Period =
  | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month'
  | 'last_7_days' | 'last_30_days' | 'last_90_days' | 'this_year'
  | 'this_financial_year' | 'all_time'

function periodToRange(period: Period | undefined): { from: Date; to: Date; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  switch (period) {
    case 'today':
      return { from: new Date(y, m, d), to: now, label: 'today' }
    case 'yesterday':
      return { from: new Date(y, m, d - 1), to: new Date(y, m, d - 1, 23, 59, 59), label: 'yesterday' }
    case 'this_week': {
      const daysSinceMonday = (now.getDay() + 6) % 7
      return { from: new Date(y, m, d - daysSinceMonday), to: now, label: 'this week' }
    }
    case 'last_month':
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59), label: 'last month' }
    case 'last_7_days':
      return { from: new Date(now.getTime() - 7 * 86_400_000), to: now, label: 'the last 7 days' }
    case 'last_30_days':
      return { from: new Date(now.getTime() - 30 * 86_400_000), to: now, label: 'the last 30 days' }
    case 'last_90_days':
      return { from: new Date(now.getTime() - 90 * 86_400_000), to: now, label: 'the last 90 days' }
    case 'this_year':
      return { from: new Date(y, 0, 1), to: now, label: 'this year' }
    case 'this_financial_year': {
      // UK tax year: 6 April to 5 April
      const start = (m > 3 || (m === 3 && d >= 6)) ? new Date(y, 3, 6) : new Date(y - 1, 3, 6)
      return { from: start, to: now, label: 'this financial year' }
    }
    case 'all_time':
      return { from: new Date(2000, 0, 1), to: now, label: 'all time' }
    case 'this_month':
    default:
      return { from: new Date(y, m, 1), to: now, label: 'this month' }
  }
}

const PERIOD_ENUM = [
  'today', 'yesterday', 'this_week', 'this_month', 'last_month',
  'last_7_days', 'last_30_days', 'last_90_days', 'this_year',
  'this_financial_year', 'all_time',
]

/** Parses a YYYY-MM-DD (or ISO) string; returns null if unusable. */
function parseDate(s: string | undefined, endOfDay: boolean): Date | null {
  if (!s || typeof s !== 'string') return null
  const trimmed = s.trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
  const d = new Date(dateOnly && endOfDay ? `${trimmed}T23:59:59` : trimmed)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Resolves a tool's time window. If the model supplied explicit `from`/`to`
 * dates (for "on the 3rd", "between June and August", "last Tuesday"), use
 * those; otherwise fall back to the named period, then the per-tool default.
 */
function resolveRange(
  input: Record<string, unknown>,
  fallback: Period = 'this_month',
): { from: Date; to: Date; label: string } {
  const from = parseDate(input['from'] as string | undefined, false)
  const to = parseDate(input['to'] as string | undefined, true)
  if (from || to) {
    const f = from ?? new Date(2000, 0, 1)
    const t = to ?? new Date()
    const fmt = (d: Date): string => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const sameDay = input['from'] === input['to'] && Boolean(input['from'])
    return { from: f, to: t, label: sameDay ? fmt(f) : `${fmt(f)} to ${fmt(t)}` }
  }
  return periodToRange((input['period'] as Period | undefined) ?? fallback)
}

// A reusable schema fragment: every time-scoped tool accepts either a named
// period or explicit from/to dates (YYYY-MM-DD) for arbitrary days/ranges.
const DATE_PROPS = {
  period: { type: 'string', enum: PERIOD_ENUM, description: 'A named period.' },
  from: { type: 'string', description: 'Start date YYYY-MM-DD (use for a specific day or custom range; overrides period).' },
  to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive). For a single day, set from and to to the same date.' },
}

interface Tool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

const TOOLS: Tool[] = [
  {
    name: 'get_account_balances',
    description: 'Get current balances for all the user\'s connected accounts, plus the total.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_spending',
    description:
      'Get total spending and a breakdown by category for a time period. Use this for "how much did I spend", "what did I spend on X", spending breakdowns, and totals.',
    input_schema: {
      type: 'object',
      properties: {
        ...DATE_PROPS,
        category: { type: 'string', description: 'Optional category filter, e.g. "groceries", "transport", "restaurants".' },
      },
      required: [],
    },
  },
  {
    name: 'search_transactions',
    description:
      'Search/list individual transactions, optionally filtered by merchant/text, period, and amount range. Use for "show my transactions", "find the £40 charge", "what did I buy at Amazon", "what did I spend on the 3rd".',
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'Merchant or description text to match (case-insensitive).' },
        ...DATE_PROPS,
        min_amount: { type: 'number', description: 'Minimum absolute amount in GBP.' },
        max_amount: { type: 'number', description: 'Maximum absolute amount in GBP.' },
        limit: { type: 'number', description: 'Max rows to return (default 15).' },
      },
      required: [],
    },
  },
  {
    name: 'find_merchants',
    description:
      'Look up which merchant names in the user\'s data match a search term, each with its total and count. Use this FIRST for "how much on/at <name>" when <name> is not a standard category (e.g. a shop, church, person, or brand). If it returns several distinct names, ask the user which one they mean before answering.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The merchant/payee text to search for, e.g. "winners chapel".' },
        ...DATE_PROPS,
      },
      required: ['query'],
    },
  },
  {
    name: 'get_merchant_spend',
    description: 'Get total spent at a specific merchant over a period, with the matching transactions.',
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'Merchant name, e.g. "Tesco", "Costa".' },
        ...DATE_PROPS,
      },
      required: ['merchant'],
    },
  },
  {
    name: 'get_subscriptions',
    description: 'List the user\'s recurring subscriptions and their total monthly cost.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_income',
    description: 'Get the user\'s detected monthly income (from salary/credits).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_cashflow_summary',
    description:
      'Totals over a period: money IN (all income/credits), money OUT (all spending/debits), the net, and how much of the "in" is salary/pay. Use for "total incoming/outgoing this financial year", "account summary" (earned vs spent), and "how much from salary". Internal transfers are excluded.',
    input_schema: {
      type: 'object',
      properties: { ...DATE_PROPS },
      required: [],
    },
  },
  {
    name: 'get_safe_to_spend',
    description:
      'How much the user can safely spend over a short horizon after upcoming bills/direct debits and a small buffer. Use for "can I afford to spend £X", "how much can I safely spend this weekend", "will I make it to payday", "is it safe to spend".',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Horizon in days: ~2 for a weekend, 7 for a week, up to ~30 for "until payday"/this month. Defaults to 7.' },
      },
      required: [],
    },
  },
  {
    name: 'get_income_from_payer',
    description:
      'Total money COMING IN from a specific named payer/source (credits matching the name) — e.g. "how much did I get from PayStream / my tenant / Jane / DWP". Not limited to salary. Use this for income from a NAMED source; use get_income only for overall monthly salary.',
    input_schema: {
      type: 'object',
      properties: {
        payer: { type: 'string', description: 'The payer/source name to match, e.g. "PayStream".' },
        ...DATE_PROPS,
      },
      required: ['payer'],
    },
  },
  {
    name: 'get_charitable_giving',
    description:
      'Charitable donations in the current UK tax year: total given, the Gift Aid uplift (25% charities can reclaim), and the list of donations. Use for "how much have I given to charity", "my donations", "how much gift aid", "charitable giving this tax year".',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_net_worth',
    description:
      'Estimated net worth: total assets (account balances) minus estimated liabilities (debt-like recurring payments such as mortgage/loan/credit card). An estimate from connected accounts only. Use for "what am I worth", "net worth", "assets vs debts".',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'compare_spending',
    description: 'Compare this month\'s spending with last month\'s, optionally for one category.',
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'get_unusual_spending',
    description: 'Find unusually large or outlier transactions in a period.',
    input_schema: {
      type: 'object',
      properties: { period: { type: 'string', enum: PERIOD_ENUM } },
      required: [],
    },
  },
  {
    name: 'get_upcoming_bills',
    description:
      'List upcoming bills, direct debits and standing orders due soon, with their amounts and due dates. Use for "upcoming payments", "what\'s due", and "when is my <X> due?" (then pick out the matching one).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_financial_overview',
    description:
      'Get a broad snapshot: balances, this/last month spend, top categories, subscriptions, income, savings rate. Use for open-ended "how am I doing" questions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
]

const gbp = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function runTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  analytics: TransactionAnalyticsService,
  prisma: PrismaClient,
): Promise<string> {
  const period = input['period'] as Period | undefined
  switch (name) {
    case 'get_account_balances': {
      const balances = await analytics.getAccountBalances(userId)
      const total = balances.reduce((s, b) => s + b.currentBalance, 0)
      return JSON.stringify({
        accounts: balances.map(b => ({
          name: b.displayName ?? b.accountType,
          type: b.accountType,
          last4: b.last4, // distinguishes same-type accounts, e.g. "••1234"
          balance: b.currentBalance,
          available: b.availableBalance,
        })),
        total_balance: total,
      })
    }
    case 'get_spending': {
      const { from, to, label } = resolveRange(input)
      const cats = await analytics.getSpendingByCategory(userId, from, to, input['category'] as string | undefined)
      const total = cats.reduce((s, c) => s + c.total, 0)
      return JSON.stringify({
        period: label,
        total_spent: total,
        by_category: cats.map(c => ({ category: c.category, amount: c.total, transactions: c.transactionCount })),
      })
    }
    case 'search_transactions': {
      const { from, to } = resolveRange(input, 'last_90_days')
      const merchant = input['merchant'] as string | undefined
      const minA = input['min_amount'] as number | undefined
      const maxA = input['max_amount'] as number | undefined
      const limit = Math.min((input['limit'] as number | undefined) ?? 15, 40)
      const result = await analytics.searchTransactions(userId, { from, to, merchant, minAmount: minA, maxAmount: maxA, limit })
      return JSON.stringify({ count: result.length, transactions: result })
    }
    case 'find_merchants': {
      const { from, to, label } = resolveRange(input, 'this_year')
      const merchants = await analytics.findMerchants(userId, (input['query'] as string) ?? '', from, to)
      return JSON.stringify({ period: label, query: input['query'], matches: merchants })
    }
    case 'get_merchant_spend': {
      const { from, to, label } = resolveRange(input, 'last_90_days')
      const merchant = (input['merchant'] as string) ?? ''
      const r = await analytics.getSpendingByMerchantName(userId, merchant, from, to)
      return JSON.stringify({ merchant, period: label, total: r.total, transaction_count: r.transactionCount, transactions: r.transactions })
    }
    case 'get_subscriptions': {
      const subs = await analytics.getSubscriptions(userId)
      const total = subs.reduce((s, x) => s + x.monthlyAmount, 0)
      return JSON.stringify({
        monthly_total: total,
        annual_total: total * 12,
        subscriptions: subs.map(s => ({ name: s.merchantName, monthly: s.monthlyAmount })),
      })
    }
    case 'get_income': {
      const profile = await analytics.getAffordabilityProfile(userId)
      return JSON.stringify({ monthly_income: profile.monthlyIncome, disposable_income: profile.disposableIncome })
    }
    case 'get_cashflow_summary': {
      const { from, to, label } = resolveRange(input, 'this_financial_year')
      const cf = await analytics.getCashflowSummary(userId, from, to)
      return JSON.stringify({
        period: label,
        total_in: cf.totalIn,
        total_out: cf.totalOut,
        net: cf.net,
        salary_total: cf.salaryTotal,
      })
    }
    case 'get_safe_to_spend': {
      const days = Math.max(1, Math.min((input['days'] as number | undefined) ?? 7, 60))
      const s = await analytics.getSafeToSpend(userId, days)
      return JSON.stringify({
        period: s.periodLabel,
        current_balance: s.currentBalance,
        bills_due_this_period: s.committedThisPeriod,
        safe_to_spend: s.safeAmount,
        warnings: s.warningFlags,
      })
    }
    case 'get_income_from_payer': {
      const { from, to, label } = resolveRange(input, 'this_financial_year')
      const payer = (input['payer'] as string) ?? ''
      const r = await analytics.getIncomeFromPayer(userId, payer, from, to)
      return JSON.stringify({
        payer,
        period: label,
        total_received: r.total,
        transaction_count: r.transactionCount,
        transactions: r.transactions,
      })
    }
    case 'get_charitable_giving': {
      const c = await getCharitySummary(prisma, userId)
      return JSON.stringify({
        tax_year: c.taxYear,
        total_donated: c.totalDonated,
        gift_aid_uplift: c.giftAidUplift,
        donation_count: c.donations.length,
        donations: c.donations.map(d => ({
          date: d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
          merchant: d.merchant,
          amount: Math.abs(d.amount),
        })),
      })
    }
    case 'get_net_worth': {
      const n = await calculateNetWorth(prisma, userId)
      return JSON.stringify({
        net_worth: n.netWorth,
        total_assets: n.totalAssets,
        estimated_liabilities: n.estimatedLiabilities,
        accounts: n.accounts,
        debt_payments: n.debtPayments,
      })
    }
    case 'compare_spending': {
      const cmp = await analytics.getMonthlyComparison(userId, input['category'] as string | undefined)
      return JSON.stringify(cmp)
    }
    case 'get_unusual_spending': {
      const { from, to } = periodToRange(period ?? 'last_30_days')
      const unusual = await analytics.getUnusualSpending(userId, from, to)
      return JSON.stringify({
        count: unusual.length,
        transactions: unusual.slice(0, 10).map(u => ({
          merchant: u.merchantName,
          amount: Math.abs(u.amount),
          date: u.transactionDate.toLocaleDateString('en-GB'),
          reason: u.reason,
        })),
      })
    }
    case 'get_upcoming_bills': {
      const text = await getUpcomingBills(prisma, userId)
      return JSON.stringify({ upcoming_bills_summary: text })
    }
    case 'get_financial_overview': {
      const snap = await analytics.getFinancialSnapshot(userId)
      return JSON.stringify({
        total_balance: snap.totalBalance,
        this_month_spend: snap.thisMonthSpend,
        last_month_spend: snap.lastMonthSpend,
        monthly_income: snap.monthlyIncome,
        savings_rate_pct: snap.savingsRate,
        top_categories: snap.topCategories.map(c => ({ category: c.category, amount: c.total })),
        subscriptions_monthly: snap.totalSubscriptions,
      })
    }
    default:
      return JSON.stringify({ error: `unknown tool ${name}` })
  }
}

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

const SYSTEM_PROMPT = `You are Monika, a warm, sharp UK personal finance assistant on WhatsApp.

You answer questions about the user's real bank data by calling the provided tools. Always call a tool to get real figures — never invent numbers. Call multiple tools if needed to fully answer.

Today is {{TODAY}}. Resolve relative dates YOURSELF and pass explicit from/to dates (YYYY-MM-DD) to the tools whenever the question is about a specific day or a custom range — "yesterday", "last Tuesday", "on the 3rd", "earlier this month", "in October", "between June and August", "since payday". For a single day, set from and to to that same date. Use the named period only for the standard buckets (this_month, last_month, this_year, …).

Use the conversation so far for context — treat short follow-ups as continuations, not new topics. If the user just asked about groceries this month and then says "what about last month?" or "and at Tesco?", carry the earlier subject over and only change what they changed.

Handling common requests:
- "how much on/at <X> (this year/month/…)": decide if <X> is a spending CATEGORY or a MERCHANT/payee.
  • Everyday category words (groceries, transport, "fast food"/"takeaways"→restaurants, "petrol"/"travel"→transport, bills, subscriptions, shopping) → get_spending with that category.
  • A specific name — a shop, brand, church, person, or anything not in that category list (e.g. "Winners Chapel", "Costa", "Halifax") → treat it as a MERCHANT: call find_merchants first. If it returns exactly one match, answer with that total. If it returns SEVERAL distinct names, DO NOT guess — reply asking the user which they mean, numbered, e.g. "I found a few — which did you mean? 1) Winners Chapel Intl  2) Winners Chapel London". If it returns none, say you couldn't find that merchant and don't substitute a category total.
- NEVER add a comparison or mention another period unless the user explicitly asks to compare (words like "compared", "vs", "more/less than", "than last month"). A plain "how much did I spend yesterday?" gets ONLY yesterday's figure — do not call compare_spending or tack on "that's £X less than last month".
- "Subscription" is ambiguous: get_subscriptions lists RECURRING subscriptions (Netflix, gym, …). If you (or the user) referred to a one-off charge in the *subscriptions category* and they ask "what subscription?" / "what was that?", find the actual transaction with search_transactions for that period/category and name the merchant — do NOT run get_subscriptions and reply "none".
- Use the conversation so far: a follow-up like "what subscription?", "which one?", "what was it?" refers to what you just told them — resolve it against the previous turn, don't treat it as a fresh, unrelated question.
- When the user has several accounts (especially same-type at one bank), name each distinctly — use its name and last-4, e.g. "Current ••1234: £500.00", "Current ••5678: £1,200.00" — don't merge them or make them ambiguous.
- "last payment to <merchant>" / "when did I last pay <merchant>" → search_transactions for that merchant; report the MOST RECENT one (date + amount).
- "when is <bill> due" / "upcoming payments" → get_upcoming_bills, then pick out the matching bill and give its due date (and note it's estimated from the usual payment cycle).
- "total incoming/outgoing (this financial year)", "account summary" (earned vs spent), "how much from salary" → get_cashflow_summary (default period this_financial_year). Report money in, money out, net, and salary separately.
- "do I have a <mortgage/loan/savings/credit card/overdraft>?" is a factual lookup, NOT an affordability calc: call get_account_balances (its accounts include the type, e.g. a "mortgage" or "savings" account) AND search_transactions for the lender or the word (e.g. "mortgage", "Halifax"). Answer plainly — "yes, you've a mortgage account (…)", or "I can see regular payments to <lender> that look like a mortgage", or "I can't see one in the connected account(s) — it may be at a bank you haven't linked." Never run an affordability analysis for this.
- "list/all payments to <merchant>" / "transactions today" → search_transactions, then LIST them (see style rule below).
- "can I afford to spend £X?" / "how much can I safely spend this weekend?" / "will I make it to payday?" / "is it safe to spend?" → get_safe_to_spend (days: ~2 for a weekend, 7 for a week, up to ~30 for "until payday"). Lead with the safe amount; mention bills due and any warning. If they named an amount, say plainly whether it fits.
- "how much did I get/receive from <named source>" where the source is NOT their salary (a tenant, a client, a person, DWP, a platform like PayStream) → get_income_from_payer. Use get_income only for overall monthly salary.
- "how much have I given to charity?" / "my donations" / "how much gift aid?" → get_charitable_giving. Report total donated this tax year and the Gift Aid uplift; add the advice disclaimer.
- "what's my net worth?" / "what am I worth?" / "assets vs debts" → get_net_worth. Call it an estimate based on connected accounts.

Style:
- British English, £ currency, format as £X,XXX.XX
- Lead with the answer — first line is the key figure or the direct answer. No throat-clearing, and don't open every reply with "Hi!", "Here's", "I've had a look" or the same stock phrase; vary it, often just state it.
- Warm and human but tight — like a clued-up friend texting, not a form letter. A couple of short lines for a simple answer; bullets only when listing several things. WhatsApp length, max ~8 short lines; *bold* (single asterisks) for key figures. At most one emoji, only if it adds warmth.
- When the user asks to see, list, or find transactions/payments (e.g. "transactions today", "all payments to Netflix"), LIST them as bullets, one per line: "• <date> — <merchant>: *£amount*", then a final "*Total: £X* across N payments" line. If there are more than ~15, show the most recent 15 and add "…and N more." Don't collapse a list request into a single sentence.
- Be specific: give the actual numbers from the tools
- If the data genuinely has nothing (e.g. no transactions in that window), say so plainly and suggest a nearby timeframe
- You are read-only: never offer to move money or make payments
- Don't suggest connecting a bank — it's already connected

REGULATORY (FCA): You provide information, not financial advice. If your answer touches savings, investments, mortgages, pensions, insurance or credit decisions, end with:
"_ℹ️ Information only, not financial advice._"
Never recommend a specific product as right for the user, and never guarantee returns.`

/**
 * Answers an arbitrary user question by letting Claude call data tools.
 * Returns the final text, or null if the model/API is unavailable.
 */
export async function answerWithAgent(
  userMessage: string,
  userId: string,
  prisma: PrismaClient,
  apiKey: string,
  history: HistoryMessage[] = [],
): Promise<string | null> {
  if (!apiKey) return null

  // Guardrail: cap paid LLM calls per user so chatter/loops can't run up cost.
  if (!allowAgentCall(userId)) {
    logger.warn({ userId }, 'Agent rate limit hit')
    return RATE_LIMIT_MESSAGE
  }

  const analytics = new TransactionAnalyticsService(prisma)
  const now = new Date()
  const todayLabel = `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${now.toISOString().slice(0, 10)})`
  const systemPrompt = SYSTEM_PROMPT.replace('{{TODAY}}', todayLabel)
  const startedAt = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  let toolCalls = 0

  // Build conversation: prior history (trimmed) + current question.
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  for (const h of history.slice(-8)) {
    messages.push({ role: h.role, content: h.content })
  }
  messages.push({ role: 'user', content: userMessage })

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 700,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
      })

      if (!response.ok) {
        logger.error({ status: response.status }, 'Agent LLM call failed')
        return null
      }

      const data = (await response.json()) as {
        content: AnthropicContentBlock[]
        stop_reason: string
        usage?: { input_tokens?: number; output_tokens?: number }
      }

      inputTokens += data.usage?.input_tokens ?? 0
      outputTokens += data.usage?.output_tokens ?? 0

      if (data.stop_reason === 'tool_use') {
        const toolUses = data.content.filter(b => b.type === 'tool_use')
        toolCalls += toolUses.length
        // Record the assistant's tool-use turn verbatim.
        messages.push({ role: 'assistant', content: data.content })
        // Execute each requested tool and feed results back.
        const toolResults = []
        for (const tu of toolUses) {
          let result: string
          try {
            result = await runTool(tu.name ?? '', tu.input ?? {}, userId, analytics, prisma)
          } catch (err) {
            logger.error({ err, tool: tu.name }, 'Agent tool execution failed')
            result = JSON.stringify({ error: 'tool failed' })
          }
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
        }
        messages.push({ role: 'user', content: toolResults })
        continue
      }

      // Final text answer — log usage so Anthropic cost/latency is visible.
      const text = data.content.find(b => b.type === 'text')?.text?.trim()
      logger.info(
        { userId, inputTokens, outputTokens, toolCalls, latencyMs: Date.now() - startedAt },
        'Agent answered',
      )
      return text && text.length > 0 ? text : null
    }
    // Ran out of iterations — fall back.
    logger.warn({ userId }, 'Agent hit max tool iterations')
    return null
  } catch (err) {
    logger.error({ err }, 'Agent handler threw')
    return null
  }
}

// Re-export for convenience in tests.
export { periodToRange, gbp, resolveRange, TOOLS }
