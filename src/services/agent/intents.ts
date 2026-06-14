export const INTENTS = [
  'spending_analysis',
  'merchant_query',
  'subscription_detection',
  'affordability_question',
  'safe_to_spend',
  'unusual_spending',
  'account_balance',
  'income_query',
  'savings_query',
  'savings_goal',
  'upcoming_bills',
  'payment_request',
  'budget',
  'net_worth',
  'spending_trends',
  'account_management',
  'onboarding_help',
  'unknown',
] as const

export type Intent = (typeof INTENTS)[number]

export interface ClassificationResult {
  intent: Intent
  confidence: 'high' | 'low'
  method: 'rules' | 'llm'
}
