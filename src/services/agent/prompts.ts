import { INTENTS, type Intent } from './intents.js'

export function buildClassificationPrompt(message: string): string {
  return `You are a financial intent classifier for a UK personal finance assistant called Monika.

Classify the following user message into exactly one of these intents:
${INTENTS.map((i) => `- ${i}`).join('\n')}

Intent definitions:
- spending_analysis: User asks about past spending, expenses, costs, or how much they spent on a category
- subscription_detection: User asks about recurring payments, subscriptions, direct debits, or memberships
- affordability_question: User asks whether they can afford something, or questions about future budgeting
- unusual_spending: User asks about anomalies, unexpected charges, weird transactions, or spending spikes
- account_balance: User asks about their current balance, available funds, or how much money they have
- onboarding_help: User needs help getting started, connecting their bank, or understanding the service
- unknown: The message doesn't match any of the above categories

Rules:
- Payment or transfer requests MUST be classified as unknown (Monika does not execute payments)
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
