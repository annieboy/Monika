import { describe, it, expect } from 'vitest'
import { routeIntent, isPaymentRequest, PAYMENT_REJECTION } from '../router.js'

describe('isPaymentRequest', () => {
  it('detects "pay to" phrasing', () => {
    expect(isPaymentRequest('Pay £50 to John')).toBe(true)
  })

  it('detects transfer', () => {
    expect(isPaymentRequest('Transfer money to my savings')).toBe(true)
  })

  it('detects "make a payment"', () => {
    expect(isPaymentRequest('Make a payment to my landlord')).toBe(true)
  })

  it('detects "pay my rent"', () => {
    expect(isPaymentRequest('Pay my rent this month')).toBe(true)
  })

  it('does not flag spending question as payment', () => {
    expect(isPaymentRequest('How much did I spend on rent?')).toBe(false)
  })

  it('does not flag balance query as payment', () => {
    expect(isPaymentRequest("What's my balance?")).toBe(false)
  })
})

describe('routeIntent — payment rejection overrides intent', () => {
  it('rejects payment request even if intent is spending_analysis', () => {
    const response = routeIntent('spending_analysis', 'Pay £100 to John')
    expect(response).toBe(PAYMENT_REJECTION)
  })

  it('rejects transfer request', () => {
    const response = routeIntent('unknown', 'Transfer £500 to my savings account')
    expect(response).toBe(PAYMENT_REJECTION)
  })
})

describe('routeIntent — stub responses per intent', () => {
  const cases: Array<[Parameters<typeof routeIntent>[0], string]> = [
    ['spending_analysis', 'How much did I spend?'],
    ['subscription_detection', 'What subscriptions do I have?'],
    ['affordability_question', 'Can I afford this?'],
    ['unusual_spending', 'Any weird spending?'],
    ['account_balance', "What's my balance?"],
    ['onboarding_help', 'Help me get started'],
    ['unknown', 'gibberish input'],
  ]

  for (const [intent, message] of cases) {
    it(`returns a non-empty string for intent "${intent}"`, () => {
      const response = routeIntent(intent, message)
      expect(typeof response).toBe('string')
      expect(response.length).toBeGreaterThan(10)
      expect(response).not.toBe(PAYMENT_REJECTION)
    })
  }
})

describe('PAYMENT_REJECTION constant', () => {
  it('contains the exact required phrase', () => {
    expect(PAYMENT_REJECTION).toContain('Payments are not supported yet.')
  })
})
