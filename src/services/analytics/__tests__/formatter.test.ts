/**
 * Analytics formatter tests — pure functions, regression guard.
 *
 * All formatters produce human-readable WhatsApp messages. These tests lock
 * in the key content: numbers, labels, plurals, empty-state copy. Any change
 * that alters figures or messaging is caught immediately.
 */
import { describe, it, expect } from 'vitest'
import {
  formatSpendingAnalysis,
  formatSubscriptions,
  formatUnusualSpending,
  formatAccountBalances,
  formatIncomeQuery,
  formatSavingsQuery,
  formatSafeToSpend,
  formatAffordability,
  buildFormattingPrompt,
} from '../formatter.js'

// ── formatSpendingAnalysis ────────────────────────────────────────────────────

describe('formatSpendingAnalysis', () => {
  const DATE = new Date('2024-03-01T00:00:00Z')
  const NO_COMPARISON = { thisMonth: 0, lastMonth: 0, changeAmount: 0, changePct: null }
  const CATEGORIES = [
    { category: 'groceries', total: 240.50, transactionCount: 12 },
    { category: 'transport', total: 85.00, transactionCount: 8 },
  ]

  it('returns empty-state message when no categories', () => {
    const out = formatSpendingAnalysis([], NO_COMPARISON, undefined, DATE)
    expect(out).toContain('No spending found')
  })

  it('includes each category name and amount', () => {
    const out = formatSpendingAnalysis(CATEGORIES, NO_COMPARISON, undefined, DATE)
    expect(out).toContain('Groceries')
    expect(out).toContain('£240.50')
    expect(out).toContain('Transport')
    expect(out).toContain('£85.00')
  })

  it('shows total spend when no category filter', () => {
    const out = formatSpendingAnalysis(CATEGORIES, NO_COMPARISON, undefined, DATE)
    expect(out).toContain('£325.50')
  })

  it('does not show grand total when category filter is applied', () => {
    const out = formatSpendingAnalysis(CATEGORIES, NO_COMPARISON, 'groceries', DATE)
    expect(out).not.toContain('£325.50')
    expect(out).toContain('groceries')
  })

  it('includes month-on-month comparison when lastMonth > 0', () => {
    const out = formatSpendingAnalysis(CATEGORIES, { thisMonth: 325.50, lastMonth: 300, changeAmount: 25.50, changePct: 8.5 }, undefined, DATE)
    expect(out).toContain('£25.50')
    expect(out).toContain('more than last month')
    expect(out).toContain('(9%)')
  })

  it('says "less" when spend decreased', () => {
    const out = formatSpendingAnalysis(CATEGORIES, { thisMonth: 325.50, lastMonth: 400, changeAmount: -74.50, changePct: -18.6 }, undefined, DATE)
    expect(out).toContain('less than last month')
  })
})

// ── formatSubscriptions ───────────────────────────────────────────────────────

describe('formatSubscriptions', () => {
  it('returns empty-state message when no subscriptions', () => {
    const out = formatSubscriptions([])
    expect(out).toContain("can't see any active subscriptions")
  })

  it('lists each subscription with monthly amount', () => {
    const out = formatSubscriptions([
      { merchantName: 'Netflix', subscriptionName: 'Netflix', monthlyAmount: 15.99, lastSeen: new Date() },
      { merchantName: 'Spotify', subscriptionName: 'Spotify', monthlyAmount: 9.99, lastSeen: new Date() },
    ])
    expect(out).toContain('Netflix')
    expect(out).toContain('£15.99/month')
    expect(out).toContain('Spotify')
  })

  it('shows correct total', () => {
    const out = formatSubscriptions([
      { merchantName: 'Netflix', subscriptionName: 'Netflix', monthlyAmount: 15.99, lastSeen: new Date() },
      { merchantName: 'Spotify', subscriptionName: 'Spotify', monthlyAmount: 9.99, lastSeen: new Date() },
    ])
    expect(out).toContain('£25.98/month')
  })

  it('uses singular "subscription" for exactly one', () => {
    const out = formatSubscriptions([{ merchantName: 'Netflix', subscriptionName: 'Netflix', monthlyAmount: 15.99, lastSeen: new Date() }])
    expect(out).toContain('1 active subscription')
    expect(out).not.toContain('1 active subscriptions')
  })
})

// ── formatUnusualSpending ─────────────────────────────────────────────────────

describe('formatUnusualSpending', () => {
  it('returns no-unusual-spending message for empty array', () => {
    const out = formatUnusualSpending([])
    expect(out).toContain('No unusual spending')
  })

  it('includes merchant name, amount, and reason', () => {
    const out = formatUnusualSpending([
      {
        amount: -249.99,
        merchantName: 'Amazon',
        transactionDate: new Date('2024-03-15'),
        category: 'shopping',
        reason: '3× your usual spend',
      },
    ])
    expect(out).toContain('Amazon')
    expect(out).toContain('£249.99')
    expect(out).toContain('3× your usual spend')
  })

  it('caps display at 6 transactions and adds overflow count', () => {
    const transactions = Array.from({ length: 9 }, (_, i) => ({
      amount: -10,
      merchantName: `Merchant ${i}`,
      transactionDate: new Date('2024-03-01'),
      category: 'other' as string | null,
      reason: 'unusual',
    }))
    const out = formatUnusualSpending(transactions)
    expect(out).toContain('…and 3 more')
  })
})

// ── formatAccountBalances ─────────────────────────────────────────────────────

describe('formatAccountBalances', () => {
  it('returns no-accounts message for empty array', () => {
    expect(formatAccountBalances([])).toContain('No accounts found')
  })

  it('shows each account name and balance', () => {
    const out = formatAccountBalances([
      { displayName: 'Current Account', accountType: 'current', currentBalance: 1250.00, availableBalance: null },
    ])
    expect(out).toContain('Current Account')
    expect(out).toContain('£1250.00')
  })

  it('shows total across all accounts when multiple', () => {
    const out = formatAccountBalances([
      { displayName: 'Current', accountType: 'current', currentBalance: 1000, availableBalance: null },
      { displayName: 'Savings', accountType: 'savings', currentBalance: 5000, availableBalance: null },
    ])
    expect(out).toContain('£6000.00')
  })

  it('shows available balance when it differs from current', () => {
    const out = formatAccountBalances([
      { displayName: 'Overdraft Account', accountType: 'current', currentBalance: 500, availableBalance: 1500 },
    ])
    expect(out).toContain('£1500.00 available')
  })

  it('does not show available when it equals current balance', () => {
    const out = formatAccountBalances([
      { displayName: 'Simple', accountType: 'current', currentBalance: 500, availableBalance: 500 },
    ])
    expect(out).not.toContain('available')
  })
})

// ── formatIncomeQuery ─────────────────────────────────────────────────────────

describe('formatIncomeQuery', () => {
  it('returns no-income-detected message when monthlyIncome is 0', () => {
    const out = formatIncomeQuery(0, null, null)
    expect(out).toContain("couldn't detect a regular salary")
  })

  it('shows monthly income amount', () => {
    const out = formatIncomeQuery(3500, null, null)
    expect(out).toContain('£3500.00')
  })

  it('shows last salary date when provided', () => {
    const out = formatIncomeQuery(3500, new Date('2024-03-28'), null)
    expect(out).toContain('28 March')
  })

  it('shows estimated next pay date when provided', () => {
    const out = formatIncomeQuery(3500, new Date('2024-03-28'), new Date('2024-04-28'))
    expect(out).toContain('28 April')
  })
})

// ── formatSavingsQuery ────────────────────────────────────────────────────────

describe('formatSavingsQuery', () => {
  it('returns no-income message when monthlyIncome is 0', () => {
    const out = formatSavingsQuery(0, 1200, null)
    expect(out).toContain("couldn't detect your income")
  })

  it('shows income, spending, and saving', () => {
    const out = formatSavingsQuery(3000, 1800, 40)
    expect(out).toContain('£3000.00')
    expect(out).toContain('£1800.00')
    expect(out).toContain('£1200.00')
  })

  it('shows savings rate and encouragement when >= 20%', () => {
    const out = formatSavingsQuery(3000, 1800, 40)
    expect(out).toContain('40%')
    expect(out).toContain('great going')
  })

  it('nudges user to save more when savings rate < 10%', () => {
    const out = formatSavingsQuery(3000, 2800, 6.7)
    expect(out).toContain('aim for 20%')
  })
})

// ── formatSafeToSpend ─────────────────────────────────────────────────────────

describe('formatSafeToSpend', () => {
  it('shows safe amount prominently', () => {
    const out = formatSafeToSpend({
      currentBalance: 1500,
      committedThisPeriod: 300,
      safeAmount: 1150,
      periodLabel: 'this week',
      warningFlags: [],
    })
    expect(out).toContain('£1150.00')
    expect(out).toContain('this week')
  })

  it('shows bills due when committedThisPeriod > 0', () => {
    const out = formatSafeToSpend({
      currentBalance: 1500, committedThisPeriod: 300, safeAmount: 1150,
      periodLabel: 'this week', warningFlags: [],
    })
    expect(out).toContain('Bills due soon: £300.00')
  })

  it('appends warning flags when present', () => {
    const out = formatSafeToSpend({
      currentBalance: 500, committedThisPeriod: 400, safeAmount: 50,
      periodLabel: 'this week', warningFlags: ['Low balance', 'Large bill due'],
    })
    expect(out).toContain('Low balance')
    expect(out).toContain('Large bill due')
  })
})

// ── formatAffordability ───────────────────────────────────────────────────────

describe('formatAffordability', () => {
  const BASE_PROFILE = {
    monthlyIncome: 4000,
    monthlyEssentials: 800,
    monthlySubscriptions: 400,
    monthlyDiscretionary: 500,
    totalMonthlyCommitted: 1200,
    disposableIncome: 2800,
    currentBalance: 8000,
    savingsRate: 30,
  }

  it('returns no-income message when monthlyIncome is 0', () => {
    const out = formatAffordability({ ...BASE_PROFILE, monthlyIncome: 0 }, 'Can I afford a sofa?')
    expect(out).toContain("couldn't detect a regular salary")
  })

  it('handles mortgage affordability query', () => {
    const out = formatAffordability(BASE_PROFILE, 'Can I afford a £250k mortgage?')
    expect(out).toContain('250k mortgage')
    expect(out).toContain('4–4.5×')
  })

  it('handles generic purchase affordability query', () => {
    const out = formatAffordability(BASE_PROFILE, 'Can I afford a £1,200 sofa?')
    expect(out).toContain('£1200.00')
    expect(out).toContain('disposable income')
  })

  it('shows financial snapshot when no amount in message', () => {
    const out = formatAffordability(BASE_PROFILE, 'How am I doing financially?')
    expect(out).toContain('Monthly income')
    expect(out).toContain('£4000.00')
    expect(out).toContain('Disposable income')
  })
})

// ── buildFormattingPrompt ─────────────────────────────────────────────────────

describe('buildFormattingPrompt', () => {
  it('includes the user message in the prompt', () => {
    const prompt = buildFormattingPrompt('spending', 'Total: £100', 'How much did I spend?')
    expect(prompt).toContain('How much did I spend?')
  })

  it('includes the structured data verbatim', () => {
    const prompt = buildFormattingPrompt('spending', 'Total: £100', 'test')
    expect(prompt).toContain('Total: £100')
  })

  it('instructs to keep all numbers exactly as shown', () => {
    const prompt = buildFormattingPrompt('spending', 'data', 'test')
    expect(prompt).toContain('do not change any figures')
  })

  it('instructs British English', () => {
    const prompt = buildFormattingPrompt('spending', 'data', 'test')
    expect(prompt).toContain('British English')
  })
})
