import type { PrismaClient } from '@prisma/client'
import type { Intent } from './intents.js'
import { TransactionAnalyticsService } from '../analytics/analytics.js'
import { extractQueryContext } from '../analytics/context.js'
import {
  formatSpendingAnalysis,
  formatSubscriptions,
  formatUnusualSpending,
  formatAccountBalances,
  polishWithLlm,
} from '../analytics/formatter.js'

// ── Payment guard ──────────────────────────────────────────────────────────

const PAYMENT_PATTERNS = [
  /\bpay\b.*\bto\b/i,
  /\btransfer\b/i,
  /\bsend\s+(money|funds|\£|\$)/i,
  /\bmake\s+a\s+payment/i,
  /\bpay\s+(someone|a\s+bill|my\s+rent|my\s+mortgage)/i,
  /\bset\s+up\s+(a\s+)?payment/i,
  /\bbank\s+transfer\b/i,
  /\bpay\s+\£\d/i,
]

export function isPaymentRequest(message: string): boolean {
  return PAYMENT_PATTERNS.some((p) => p.test(message))
}

export const PAYMENT_REJECTION =
  'Payments are not supported yet. Monika is a read-only finance assistant — I can show you your money, but I cannot move it.'

const NO_BANK_MESSAGE =
  "You haven't connected a bank account yet. To get started, reply with \"Connect my bank\" and I'll walk you through it."

// ── Static responses for intents that don't need data ─────────────────────

const STATIC_RESPONSES: Partial<Record<Intent, string>> = {
  onboarding_help:
    "Welcome to Monika! I'm your AI-powered UK finance assistant. To get started, connect your bank account — I'll then help you track spending, spot subscriptions, and answer questions about your money.",
  affordability_question:
    "To answer affordability questions accurately I need to see your income and recent outgoings. I can see your balance and spending — ask me things like \"What's my balance?\" or \"How much have I spent this month?\" to help you decide.",
  unknown:
    "I didn't quite understand that. You can ask me things like: \"How much did I spend on groceries?\", \"What subscriptions am I paying for?\", or \"What's my balance?\"",
}

// ── Main router ────────────────────────────────────────────────────────────

export async function routeIntent(
  intent: Intent,
  message: string,
  userId: string,
  prisma: PrismaClient,
  anthropicApiKey = '',
): Promise<string> {
  // Payment requests are blocked before any DB access
  if (isPaymentRequest(message)) return PAYMENT_REJECTION

  // Static intents need no data lookup
  const staticResponse = STATIC_RESPONSES[intent]
  if (staticResponse) return staticResponse

  const analytics = new TransactionAnalyticsService(prisma)

  // All data-driven intents require an active bank connection
  if (!(await analytics.hasActiveBankConnection(userId))) {
    return NO_BANK_MESSAGE
  }

  const { fromDate, toDate, categoryFilter } = extractQueryContext(message)

  let structuredText: string

  switch (intent) {
    case 'spending_analysis': {
      const [categories, comparison] = await Promise.all([
        analytics.getSpendingByCategory(userId, fromDate, toDate, categoryFilter),
        analytics.getMonthlyComparison(userId, categoryFilter),
      ])
      structuredText = formatSpendingAnalysis(categories, comparison, categoryFilter, fromDate)
      break
    }

    case 'subscription_detection': {
      const subscriptions = await analytics.getSubscriptions(userId)
      structuredText = formatSubscriptions(subscriptions)
      break
    }

    case 'unusual_spending': {
      // Use a 30-day window for anomaly detection regardless of message phrasing
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

    default:
      return STATIC_RESPONSES['unknown']!
  }

  // Optionally polish with LLM — falls back to structuredText on any failure
  if (anthropicApiKey) {
    return polishWithLlm(intent, structuredText, message, anthropicApiKey)
  }

  return structuredText
}
