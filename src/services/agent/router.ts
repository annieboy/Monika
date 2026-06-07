import type { Intent } from './intents.js'

// Phrases that indicate a payment/transfer request — rejected regardless of intent.
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

const STUB_RESPONSES: Record<Intent, string> = {
  spending_analysis:
    "I can see your spending — but your bank account isn't connected yet. Once you link your bank, I'll show you a full breakdown by category.",
  subscription_detection:
    "I'll scan your transactions for subscriptions and direct debits. Connect your bank account and I'll show you everything you're signed up to.",
  affordability_question:
    "To answer affordability questions accurately I need to see your income and outgoings. Connect your bank account to get started.",
  unusual_spending:
    "I'll flag any unusual or unexpected charges once your bank account is connected.",
  account_balance:
    "Connect your bank account and I'll show your current balance across all accounts.",
  onboarding_help:
    "Welcome to Monika! I'm your AI-powered UK finance assistant. To get started, connect your bank account — I'll then help you track spending, spot subscriptions, and answer questions about your money.",
  unknown:
    "I didn't quite understand that. You can ask me things like: \"How much did I spend on groceries?\", \"What subscriptions am I paying for?\", or \"What's my balance?\"",
}

export const PAYMENT_REJECTION =
  'Payments are not supported yet. Monika is a read-only finance assistant — I can show you your money, but I cannot move it.'

export function routeIntent(intent: Intent, message: string): string {
  if (isPaymentRequest(message)) return PAYMENT_REJECTION
  return STUB_RESPONSES[intent]
}
