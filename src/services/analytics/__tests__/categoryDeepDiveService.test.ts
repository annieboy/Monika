import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCategoryDeepDive, formatCategoryDeepDive } from '../categoryDeepDiveService.js'

const NOW = new Date('2026-03-15T12:00:00Z')

function makePrisma(opts: {
  thisMonthAmount?: number
  lastMonthAmount?: number
  count?: number
  transactions?: object[]
  merchantRows?: object[]
}) {
  const {
    thisMonthAmount = -200,
    lastMonthAmount = -180,
    count = 8,
    transactions = [],
    merchantRows = [],
  } = opts

  let aggregateCall = 0
  return {
    transaction: {
      aggregate: vi.fn().mockImplementation(() => {
        aggregateCall++
        if (aggregateCall === 1) return Promise.resolve({ _sum: { amount: thisMonthAmount }, _count: { id: count } })
        return Promise.resolve({ _sum: { amount: lastMonthAmount } })
      }),
      findMany: vi.fn().mockResolvedValue(transactions),
      groupBy: vi.fn().mockResolvedValue(merchantRows),
    },
  } as unknown as PrismaClient
}

describe('getCategoryDeepDive', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns this month and last month totals', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ thisMonthAmount: -300, lastMonthAmount: -250 })
    const result = await getCategoryDeepDive(prisma, 'u1', 'groceries', NOW)
    expect(result.thisMonth).toBe(300)
    expect(result.lastMonth).toBe(250)
    expect(result.changeAmt).toBe(50)
  })

  it('computes changePct correctly', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ thisMonthAmount: -110, lastMonthAmount: -100 })
    const result = await getCategoryDeepDive(prisma, 'u1', 'eating out', NOW)
    expect(result.changePct).toBeCloseTo(0.1, 2)
  })

  it('sets changePct to null when last month is zero', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ thisMonthAmount: -100, lastMonthAmount: 0 })
    const result = await getCategoryDeepDive(prisma, 'u1', 'transport', NOW)
    expect(result.changePct).toBeNull()
  })

  it('computes daily average based on day of month', async () => {
    vi.setSystemTime(NOW) // 15 March
    const prisma = makePrisma({ thisMonthAmount: -300 })
    const result = await getCategoryDeepDive(prisma, 'u1', 'groceries', NOW)
    expect(result.dailyAverage).toBeCloseTo(300 / 15, 1)
  })

  it('returns transaction count', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ count: 12 })
    const result = await getCategoryDeepDive(prisma, 'u1', 'groceries', NOW)
    expect(result.transactionCount).toBe(12)
  })
})

describe('formatCategoryDeepDive', () => {
  it('shows category, total, and comparison', () => {
    const out = formatCategoryDeepDive({
      category: 'Groceries',
      thisMonth: 300,
      lastMonth: 250,
      changeAmt: 50,
      changePct: 0.2,
      transactionCount: 10,
      dailyAverage: 20,
      topMerchants: [{ merchant: 'Tesco', total: 180, count: 5 }],
      recentTransactions: [],
    })
    expect(out).toMatch(/Groceries/)
    expect(out).toMatch(/£300/)
    expect(out).toMatch(/\+20%/)
    expect(out).toMatch(/Tesco/)
  })

  it('shows down arrow for decrease', () => {
    const out = formatCategoryDeepDive({
      category: 'Eating out',
      thisMonth: 80,
      lastMonth: 120,
      changeAmt: -40,
      changePct: -0.33,
      transactionCount: 4,
      dailyAverage: 5.3,
      topMerchants: [],
      recentTransactions: [],
    })
    expect(out).toMatch(/📉/)
    expect(out).toMatch(/-33%/)
  })
})
