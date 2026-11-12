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
import type { HistoryMessage } from '../conversation/sessionService.js'
import { allowAgentCall } from './rateLimiter.js'
import { logger } from '../../logger.js'

const RATE_LIMIT_MESSAGE =
  "You're asking a lot in a short burst — give me a minute to catch up, then try again. 🙂"

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOOL_ITERATIONS = 6

type Period =
  | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month'
  | 'last_7_days' | 'last_30_days' | 'last_90_days' | 'this_year' | 'all_time'

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
    case 'all_time':
      return { from: new Date(2000, 0, 1), to: now, label: 'all time' }
    case 'this_month':
    default:
      return { from: new Date(y, m, 1), to: now, label: 'this month' }
  }
}

const PERIOD_ENUM = [
  'today', 'yesterday', 'this_week', 'this_month', 'last_month',
  'last_7_days', 'last_30_days', 'last_90_days', 'this_year', 'all_time',
]

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
        period: { type: 'string', enum: PERIOD_ENUM, description: 'Time period. Defaults to this_month.' },
        category: { type: 'string', description: 'Optional category filter, e.g. "groceries", "transport", "restaurants".' },
      },
      required: [],
    },
  },
  {
    name: 'search_transactions',
    description:
      'Search/list individual transactions, optionally filtered by merchant/text, period, and amount range. Use for "show my transactions", "find the £40 charge", "what did I buy at Amazon".',
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'Merchant or description text to match (case-insensitive).' },
        period: { type: 'string', enum: PERIOD_ENUM },
        min_amount: { type: 'number', description: 'Minimum absolute amount in GBP.' },
        max_amount: { type: 'number', description: 'Maximum absolute amount in GBP.' },
        limit: { type: 'number', description: 'Max rows to return (default 15).' },
      },
      required: [],
    },
  },
  {
    name: 'get_merchant_spend',
    description: 'Get total spent at a specific merchant over a period, with the matching transactions.',
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'Merchant name, e.g. "Tesco", "Costa".' },
        period: { type: 'string', enum: PERIOD_ENUM },
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
          balance: b.currentBalance,
          available: b.availableBalance,
        })),
        total_balance: total,
      })
    }
    case 'get_spending': {
      const { from, to, label } = periodToRange(period)
      const cats = await analytics.getSpendingByCategory(userId, from, to, input['category'] as string | undefined)
      const total = cats.reduce((s, c) => s + c.total, 0)
      return JSON.stringify({
        period: label,
        total_spent: total,
        by_category: cats.map(c => ({ category: c.category, amount: c.total, transactions: c.transactionCount })),
      })
    }
    case 'search_transactions': {
      const { from, to } = periodToRange(period ?? 'last_90_days')
      const merchant = input['merchant'] as string | undefined
      const minA = input['min_amount'] as number | undefined
      const maxA = input['max_amount'] as number | undefined
      const limit = Math.min((input['limit'] as number | undefined) ?? 15, 40)
      const result = await analytics.searchTransactions(userId, { from, to, merchant, minAmount: minA, maxAmount: maxA, limit })
      return JSON.stringify({ count: result.length, transactions: result })
    }
    case 'get_merchant_spend': {
      const { from, to, label } = periodToRange(period ?? 'last_90_days')
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

Use the conversation so far for context — treat short follow-ups as continuations, not new topics. If the user just asked about groceries this month and then says "what about last month?" or "and at Tesco?", carry the earlier subject over and only change what they changed.

Handling common requests:
- "how much on <category/merchant> (this month/…)" → get_spending with a category, or get_merchant_spend for a named merchant (e.g. Uber Eats, Tesco). Map everyday terms: "fast food"/"takeaways"→restaurants, "petrol"/"travel"→transport, "bills"→bills.
- "last payment to <merchant>" / "when did I last pay <merchant>" → search_transactions for that merchant; report the MOST RECENT one (date + amount).
- "when is <bill> due" / "upcoming payments" → get_upcoming_bills, then pick out the matching bill and give its due date (and note it's estimated from the usual payment cycle).
- "list/all payments to <merchant>" / "transactions today" → search_transactions, then LIST them (see style rule below).

Style:
- British English, £ currency, format as £X,XXX.XX
- Concise and friendly — WhatsApp length, max ~8 short lines; use *bold* (single asterisks) for key figures, and bullet points where helpful
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
          system: SYSTEM_PROMPT,
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
export { periodToRange, gbp }
