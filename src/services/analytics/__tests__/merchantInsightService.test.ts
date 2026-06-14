import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getMerchantInsight, formatMerchantInsight } from '../merchantInsightService.js'

const NOW = new Date('2026-03-15T12:00:00Z')

function makePrisma(opts: {
  totalAmount?: number
  count?: number
  firstDate?: Date
  lastDate?: Date
  recentAmount?: number
  priorAmount?: number
}) {
  const {
    totalAmount = -200,
    count = 5,
    firstDate = new Date('2025-01-01'),
    lastDate = new Date('2026-03-01'),
    recentAmount = -60,
    priorAmount = -40,
  } = opts

  let aggregateCall = 0
  return {
    transaction: {
      aggregate: vi.fn().mockImplementation(() => {
        aggregateCall++
        if (aggregateCall === 1) {
          return Promise.resolve({
            _sum: { amount: totalAmount },
            _count: { id: count },
            _min: { transactionDate: firstDate },
            _max: { transactionDate: lastDate },
          })
        }
        if (aggregateCall === 2) return Promise.resolve({ _sum: { amount: recentAmount } })
        return Promise.resolve({ _sum: { amount: priorAmount } })
      }),
    },
  } as unknown as PrismaClient
}

describe('getMerchantInsight', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns null when no transactions found', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ count: 0, totalAmount: 0 })
    const result = await getMerchantInsight(prisma, 'u1', 'Waitrose')
    expect(result).toBeNull()
  })

  it('returns correct visit count and total spend', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ totalAmount: -300, count: 10 })
    const result = await getMerchantInsight(prisma, 'u1', 'Tesco')
    expect(result?.visitCount).toBe(10)
    expect(result?.totalSpend).toBe(300)
    expect(result?.averagePerVisit).toBe(30)
  })

  it('calculates increasing trend when recent > prior by > 20%', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ recentAmount: -120, priorAmount: -80 })
    const result = await getMerchantInsight(prisma, 'u1', 'Deliveroo')
    expect(result?.trend).toBe('increasing')
  })

  it('calculates decreasing trend when recent < prior by > 20%', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ recentAmount: -50, priorAmount: -90 })
    const result = await getMerchantInsight(prisma, 'u1', 'Uber Eats')
    expect(result?.trend).toBe('decreasing')
  })

  it('calculates stable trend within ±20%', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ recentAmount: -100, priorAmount: -105 })
    const result = await getMerchantInsight(prisma, 'u1', 'Sainsbury\'s')
    expect(result?.trend).toBe('stable')
  })

  it('sets insufficient_data when either period is zero', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ recentAmount: 0, priorAmount: 0 })
    const result = await getMerchantInsight(prisma, 'u1', 'Amazon')
    expect(result?.trend).toBe('insufficient_data')
  })
})

describe('formatMerchantInsight', () => {
  it('shows merchant name, totals, and visit count', () => {
    const out = formatMerchantInsight({
      merchant: 'Tesco',
      totalSpend: 500,
      visitCount: 20,
      averagePerVisit: 25,
      firstSeen: new Date('2025-01-15'),
      lastSeen: new Date('2026-03-10'),
      monthlyAverage: 40,
      recentMonthSpend: 60,
      priorMonthSpend: 45,
      trend: 'increasing',
    })
    expect(out).toMatch(/Tesco/)
    expect(out).toMatch(/£500/)
    expect(out).toMatch(/20/)
    expect(out).toMatch(/increasing/i)
  })

  it('omits trend section for insufficient data', () => {
    const out = formatMerchantInsight({
      merchant: 'Rare Shop',
      totalSpend: 10,
      visitCount: 1,
      averagePerVisit: 10,
      firstSeen: new Date('2026-03-01'),
      lastSeen: new Date('2026-03-01'),
      monthlyAverage: 10,
      recentMonthSpend: 0,
      priorMonthSpend: 0,
      trend: 'insufficient_data',
    })
    expect(out).not.toMatch(/📈|📉|→/)
  })
})
