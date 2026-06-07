export const INTENTS = [
  'spending_analysis',
  'subscription_detection',
  'affordability_question',
  'unusual_spending',
  'account_balance',
  'onboarding_help',
  'unknown',
] as const

export type Intent = (typeof INTENTS)[number]

export interface ClassificationResult {
  intent: Intent
  confidence: 'high' | 'low'
  method: 'rules' | 'llm'
}
