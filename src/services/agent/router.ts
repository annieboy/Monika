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
import { generateOnboardingToken } from '../onboarding/token.js'
import { logConsentEvent } from '../onboarding/audit.js'
import { trackEvent } from '../analytics/events.js'
import { config } from '../../config.js'

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
  "Welcome to Monika! I'm your AI-powered UK finance assistant. Ask me about your spending, subscriptions, balance, or unusual transactions. To get started, say \"connect my bank\"."

const STATIC_AFFORDABILITY =
  "To answer affordability questions I need to see your income and outgoings. Ask me \"What's my balance?\" or \"How much have I spent this month?\" to help you decide."

const STATIC_UNKNOWN =
  "I didn't quite understand that. You can ask me things like: \"How much did I spend on groceries?\", \"What subscriptions am I paying for?\", or \"What's my balance?\""

// ── Main router ────────────────────────────────────────────────────────────

export async function routeIntent(
  intent: Intent,
  message: string,
  userId: string,
  prisma: PrismaClient,
  anthropicApiKey = '',
): Promise<string> {
  // Payment requests blocked unconditionally
  if (isPaymentRequest(message)) return PAYMENT_REJECTION

  const analytics = new TransactionAnalyticsService(prisma)

  // ── onboarding_help ────────────────────────────────────────────────────
  if (intent === 'onboarding_help') {
    // "connect my bank" → generate a personalised link
    if (isConnectBankRequest(message)) {
      const alreadyConnected = await analytics.hasActiveBankConnection(userId)
      if (alreadyConnected) {
        return "Your bank is already connected. You can ask me about your spending, subscriptions, or balance."
      }
      return buildConnectLink(prisma, userId)
    }
    return STATIC_ONBOARDING
  }

  // ── Static non-data intents ─────────────────────────────────────────────
  if (intent === 'affordability_question') return STATIC_AFFORDABILITY
  if (intent === 'unknown') return STATIC_UNKNOWN

  // ── Data-driven intents ─────────────────────────────────────────────────
  // All require an active bank connection; missing connection → generate link
  if (!(await analytics.hasActiveBankConnection(userId))) {
    return buildConnectLink(prisma, userId)
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
      return STATIC_UNKNOWN
  }

  if (anthropicApiKey) {
    const polished = await polishWithLlm(intent, structuredText, message, anthropicApiKey)
    // polishWithLlm returns structuredText unchanged on LLM failure — detect and track
    if (polished === structuredText) {
      trackEvent(prisma, 'ai_error', userId, { intent, reason: 'llm_fallback' }).catch(() => undefined)
    }
    return polished
  }

  return structuredText
}
