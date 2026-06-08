import { INTENTS, type Intent } from './intents.js'

export function buildClassificationPrompt(message: string): string {
  return `You are a financial intent classifier for a UK personal finance assistant called Monika.

Classify the following user message into exactly one of these intents:
${INTENTS.map((i) => `- ${i}`).join('\n')}

Intent definitions:
- spending_analysis: How much spent on a category or in general (groceries, eating out, transport, etc.)
- merchant_query: How much spent at a specific merchant or shop (Tesco, Amazon, Deliveroo, etc.)
- subscription_detection: Recurring payments, subscriptions, direct debits, memberships
- affordability_question: Can I afford a specific purchase, mortgage, or financial commitment
- safe_to_spend: How much can I spend right now, this weekend, or this week
- unusual_spending: Anomalies, unexpected charges, weird transactions, spending spikes
- account_balance: Current balance, available funds, how much money in accounts
- income_query: Salary, wages, when paid, how much earned, next payday
- savings_query: How much saved, savings rate, could I save more
- upcoming_bills: Bills due, direct debits coming up, what I owe this month
- payment_request: User wants to send money, make a transfer, pay someone (Monika cannot do this)
- onboarding_help: Help getting started, connecting bank, understanding the service
- unknown: Anything else or unclear intent

Rules:
- Payment/transfer requests MUST be classified as payment_request
- Always respond with a single JSON object, no commentary

User message: "${message.replace(/"/g, '\\"')}"

Respond with this exact JSON structure:
{"intent": "<one of the intents above>", "confidence": "high" | "low"}`
}

export function parseClassificationResponse(response: string): { intent: Intent; confidence: 'high' | 'low' } | null {
  try {
    const jsonMatch = response.match(/\{[^}]+\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as { intent: string; confidence: string }
    const intent = parsed.intent as Intent
    if (!INTENTS.includes(intent)) return null
    const confidence = parsed.confidence === 'high' ? 'high' : 'low'
    return { intent, confidence }
  } catch {
    return null
  }
}
