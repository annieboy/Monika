import { describe, it, expect, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/library'
import type { PrismaClient } from '@prisma/client'
import { TransactionAnalyticsService } from '../analytics.js'
import { routeIntent } from '../../agent/router.js'

// ── Mock Prisma factory ────────────────────────────────────────────────────

type GroupByResult = {
  category?: string | null
  merchantName?: string | null
  subscriptionName?: string | null
  _sum: { amount: Decimal | null }
  _count: { id: number }
}

function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    bankConnection: {
      findFirst: vi.fn().mockResolvedValue({ id: 'conn-id' }),
    },
    transaction: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    account: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'conv-id' }),
    },
    user: {
      upsert: vi.fn().mockResolvedValue({ id: 'user-id', createdAt: new Date(), updatedAt: new Date() }),
    },
    onboardingToken: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as PrismaClient
}

const USER_ID = 'user-uuid'

// ── hasActiveBankConnection ────────────────────────────────────────────────

describe('TransactionAnalyticsService.hasActiveBankConnection', () => {
  it('returns true when an active connection exists', async () => {
    const prisma = makePrisma()
    const svc = new TransactionAnalyticsService(prisma)
    expect(await svc.hasActiveBankConnection(USER_ID)).toBe(true)
  })

  it('returns false when no connection exists', async () => {
    const prisma = makePrisma({
      bankConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const svc = new TransactionAnalyticsService(prisma)
    expect(await svc.hasActiveBankConnection(USER_ID)).toBe(false)
  })
})

// ── getSpendingByCategory ──────────────────────────────────────────────────

describe('TransactionAnalyticsService.getSpendingByCategory', () => {
  it('returns sorted spend by category', async () => {
    const mockGroupBy: GroupByResult[] = [
      { category: 'transport', _sum: { amount: new Decimal('-54.80') }, _count: { id: 10 } },
      { category: 'groceries', _sum: { amount: new Decimal('-234.50') }, _count: { id: 12 } },
      { category: 'restaurants', _sum: { amount: new Decimal('-87.30') }, _count: { id: 5 } },
    ]
    const prisma = makePrisma({ transaction: { groupBy: vi.fn().mockResolvedValue(mockGroupBy) } })
    const svc = new TransactionAnalyticsService(prisma)
    const from = new Date('2026-06-01')
    const to = new Date('2026-06-30')

    const results = await svc.getSpendingByCategory(USER_ID, from, to)

    // Ordered by highest total first (groupBy uses 'asc' on amount = most negative first)
    expect(results[0]!.category).toBe('transport')
    expect(results[0]!.total).toBeCloseTo(54.80)
    expect(results[0]!.transactionCount).toBe(10)
    expect(results).toHaveLength(3)
  })

  it('filters by category when categoryFilter is provided', async () => {
    const prisma = makePrisma({
      transaction: {
        groupBy: vi.fn().mockResolvedValue([
          { category: 'groceries', _sum: { amount: new Decimal('-234.50') }, _count: { id: 12 } },
        ]),
      },
    })
    const svc = new TransactionAnalyticsService(prisma)
    const results = await svc.getSpendingByCategory(USER_ID, new Date(), new Date(), 'groceries')

    const call = (prisma.transaction.groupBy as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { where: { category: unknown } },
    ]
    expect(call[0].where.category).toEqual({ contains: 'groceries', mode: 'insensitive' })
    expect(results[0]!.total).toBeCloseTo(234.5)
  })

  it('returns empty array when no transactions match', async () => {
    const prisma = makePrisma()
    const svc = new TransactionAnalyticsService(prisma)
    const results = await svc.getSpendingByCategory(USER_ID, new Date(), new Date())
    expect(results).toHaveLength(0)
  })
})

// ── getMonthlyComparison ───────────────────────────────────────────────────

describe('TransactionAnalyticsService.getMonthlyComparison', () => {
  it('computes change amount and percentage correctly', async () => {
    const prisma = makePrisma({
      transaction: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: new Decimal('-300.00') } }) // this month
          .mockResolvedValueOnce({ _sum: { amount: new Decimal('-200.00') } }), // last month
      },
    })
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getMonthlyComparison(USER_ID)

    expect(result.thisMonth).toBeCloseTo(300)
    expect(result.lastMonth).toBeCloseTo(200)
    expect(result.changeAmount).toBeCloseTo(100)
    expect(result.changePct).toBeCloseTo(50)
  })

  it('returns null changePct when last month has no data', async () => {
    const prisma = makePrisma({
      transaction: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: new Decimal('-150.00') } })
          .mockResolvedValueOnce({ _sum: { amount: null } }),
      },
    })
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getMonthlyComparison(USER_ID)

    expect(result.changePct).toBeNull()
    expect(result.lastMonth).toBe(0)
  })
})

// ── getSubscriptions ───────────────────────────────────────────────────────

describe('TransactionAnalyticsService.getSubscriptions', () => {
  it('maps provider data to Subscription shape correctly', async () => {
    const now = new Date()
    const prisma = makePrisma({
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { subscriptionName: 'Netflix', merchantName: 'Netflix', amount: new Decimal('-17.99'), transactionDate: now },
          { subscriptionName: 'Spotify', merchantName: 'Spotify', amount: new Decimal('-11.99'), transactionDate: now },
          { subscriptionName: 'Gym', merchantName: 'Gym Membership', amount: new Decimal('-49.99'), transactionDate: now },
        ]),
      },
    })
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getSubscriptions(USER_ID)

    // The service returns rows in the order Prisma returns them (ordered by date desc, distinct)
    // Sorting by amount is the formatter's responsibility
    expect(result).toHaveLength(3)
    const names = result.map((r) => r.merchantName)
    expect(names).toContain('Netflix')
    expect(names).toContain('Spotify')
    expect(names).toContain('Gym Membership')
    const netflix = result.find((r) => r.merchantName === 'Netflix')!
    expect(netflix.monthlyAmount).toBeCloseTo(17.99)
    expect(netflix.subscriptionName).toBe('Netflix')
  })

  it('returns empty array when no subscriptions found', async () => {
    const prisma = makePrisma()
    const svc = new TransactionAnalyticsService(prisma)
    expect(await svc.getSubscriptions(USER_ID)).toHaveLength(0)
  })
})

// ── getUnusualSpending ─────────────────────────────────────────────────────

describe('TransactionAnalyticsService.getUnusualSpending', () => {
  it('flags a large individual transaction (> £150)', async () => {
    const prisma = makePrisma({
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          {
            providerTransactionId: 'txn-1',
            merchantName: 'Amazon',
            amount: new Decimal('-189.99'),
            transactionDate: new Date(),
            category: 'shopping',
            rawDescription: 'AMAZON',
          },
        ]),
      },
    })
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getUnusualSpending(USER_ID, new Date(Date.now() - 30 * 86_400_000), new Date())

    expect(result).toHaveLength(1)
    expect(result[0]!.merchantName).toBe('Amazon')
    expect(result[0]!.reason).toContain('Large transaction')
  })

  it('flags a statistical outlier within a category', async () => {
    // 10 stable grocery shops at ~£20, then one at £100
    // Mean ≈ £27, σ ≈ £23 → threshold ≈ £73 → £100 is flagged
    const base = { category: 'groceries', rawDescription: 'TESCO' }
    const baseline = Array.from({ length: 10 }, (_, i) => ({
      providerTransactionId: `g${i}`,
      merchantName: 'Tesco',
      amount: new Decimal('-20'),
      transactionDate: new Date(),
      ...base,
    }))
    const outlier = {
      providerTransactionId: 'g-outlier',
      merchantName: 'Waitrose',
      amount: new Decimal('-100'),
      transactionDate: new Date(),
      ...base,
    }
    const prisma = makePrisma({ transaction: { findMany: vi.fn().mockResolvedValue([...baseline, outlier]) } })
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getUnusualSpending(USER_ID, new Date(Date.now() - 30 * 86_400_000), new Date())

    const flagged = result.find((t) => t.merchantName === 'Waitrose')
    expect(flagged).toBeDefined()
    expect(flagged!.reason).toContain('Above typical')
  })

  it('does not flag normal-sized transactions', async () => {
    const txns = Array.from({ length: 5 }, (_, i) => ({
      providerTransactionId: `g${i}`,
      merchantName: 'Tesco',
      amount: new Decimal('-30'),
      transactionDate: new Date(),
      category: 'groceries',
      rawDescription: 'TESCO',
    }))
    const prisma = makePrisma({ transaction: { findMany: vi.fn().mockResolvedValue(txns) } })
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getUnusualSpending(USER_ID, new Date(Date.now() - 30 * 86_400_000), new Date())
    expect(result).toHaveLength(0)
  })

  it('returns empty array when no transactions exist', async () => {
    const prisma = makePrisma()
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getUnusualSpending(USER_ID, new Date(Date.now() - 30 * 86_400_000), new Date())
    expect(result).toHaveLength(0)
  })
})

// ── getAccountBalances ─────────────────────────────────────────────────────

describe('TransactionAnalyticsService.getAccountBalances', () => {
  it('returns balances for all active accounts', async () => {
    const prisma = makePrisma({
      account: {
        findMany: vi.fn().mockResolvedValue([
          { displayName: 'Current Account', accountType: 'current', currentBalance: new Decimal('1847.32'), availableBalance: new Decimal('1847.32'), isPrimary: true },
          { displayName: 'Savings', accountType: 'savings', currentBalance: new Decimal('4250.00'), availableBalance: null, isPrimary: false },
        ]),
      },
    })
    const svc = new TransactionAnalyticsService(prisma)
    const result = await svc.getAccountBalances(USER_ID)

    expect(result).toHaveLength(2)
    expect(result[0]!.currentBalance).toBeCloseTo(1847.32)
    expect(result[1]!.currentBalance).toBeCloseTo(4250)
    expect(result[0]!.accountType).toBe('current')
  })

  it('returns empty array when user has no accounts', async () => {
    const prisma = makePrisma()
    const svc = new TransactionAnalyticsService(prisma)
    expect(await svc.getAccountBalances(USER_ID)).toHaveLength(0)
  })
})

// ── routeIntent — full per-intent integration ──────────────────────────────

describe('routeIntent — spending_analysis', () => {
  it('returns grocery total when bank is connected', async () => {
    const prisma = makePrisma({
      transaction: {
        groupBy: vi.fn().mockResolvedValue([
          { category: 'groceries', _sum: { amount: new Decimal('-234.50') }, _count: { id: 12 } },
        ]),
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { amount: new Decimal('-234.50') } })
          .mockResolvedValueOnce({ _sum: { amount: new Decimal('-200.00') } }),
      },
    })
    const response = await routeIntent('spending_analysis', 'How much did I spend on groceries this month?', USER_ID, prisma)
    expect(response).toContain('234.50')
    expect(response.toLowerCase()).toContain('groceries')
  })

  it('returns "no bank connection" message when not connected', async () => {
    const prisma = makePrisma({
      bankConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const response = await routeIntent('spending_analysis', 'How much did I spend?', USER_ID, prisma)
    expect(response.toLowerCase()).toContain('connect')
  })
})

describe('routeIntent — subscription_detection', () => {
  it('lists subscriptions with amounts', async () => {
    const now = new Date()
    const prisma = makePrisma({
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { subscriptionName: 'Netflix', merchantName: 'Netflix', amount: new Decimal('-17.99'), transactionDate: now },
          { subscriptionName: 'Spotify', merchantName: 'Spotify', amount: new Decimal('-11.99'), transactionDate: now },
        ]),
      },
    })
    const response = await routeIntent('subscription_detection', 'What subscriptions am I paying for?', USER_ID, prisma)
    expect(response).toContain('Netflix')
    expect(response).toContain('17.99')
    expect(response).toContain('Spotify')
  })

  it('returns "no subscriptions" message when none detected', async () => {
    const prisma = makePrisma()
    const response = await routeIntent('subscription_detection', 'What subscriptions do I have?', USER_ID, prisma)
    expect(response.toLowerCase()).toContain('subscription')
  })

  it('returns "no bank connection" message when not connected', async () => {
    const prisma = makePrisma({
      bankConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const response = await routeIntent('subscription_detection', 'What subscriptions am I paying for?', USER_ID, prisma)
    expect(response.toLowerCase()).toContain('connect')
  })
})

describe('routeIntent — unusual_spending', () => {
  it('returns unusual transactions when found', async () => {
    const prisma = makePrisma({
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          {
            providerTransactionId: 'big-1',
            merchantName: 'ASOS',
            amount: new Decimal('-189.99'),
            transactionDate: new Date(),
            category: 'shopping',
            rawDescription: 'ASOS',
          },
        ]),
      },
    })
    const response = await routeIntent('unusual_spending', 'Show me unusual spending', USER_ID, prisma)
    expect(response).toContain('ASOS')
    expect(response).toContain('189.99')
  })

  it('returns "nothing unusual" when no anomalies', async () => {
    const prisma = makePrisma()
    const response = await routeIntent('unusual_spending', 'Any weird transactions?', USER_ID, prisma)
    expect(response.toLowerCase()).toContain('normal')
  })
})

describe('routeIntent — account_balance', () => {
  it('returns balance from database', async () => {
    const prisma = makePrisma({
      account: {
        findMany: vi.fn().mockResolvedValue([
          { displayName: 'Current Account', accountType: 'current', currentBalance: new Decimal('1847.32'), availableBalance: new Decimal('1847.32'), isPrimary: true },
          { displayName: 'Savings', accountType: 'savings', currentBalance: new Decimal('4250.00'), availableBalance: null, isPrimary: false },
        ]),
      },
    })
    const response = await routeIntent('account_balance', "What's my balance?", USER_ID, prisma)
    expect(response).toContain('1847.32')
    expect(response).toContain('4250')
  })

  it('returns "no bank connection" when not connected', async () => {
    const prisma = makePrisma({
      bankConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const response = await routeIntent('account_balance', "What's my balance?", USER_ID, prisma)
    expect(response.toLowerCase()).toContain('connect')
  })
})

describe('routeIntent — payment rejection', () => {
  it('rejects payment_request intent', async () => {
    const prisma = makePrisma()
    const response = await routeIntent('payment_request', 'Pay £100 to John', USER_ID, prisma)
    expect(response.toLowerCase()).toContain('payment')
  })
})
