import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCreditHealthReport, formatCreditHealthReport } from '../creditHealthService.js'

const NOW = new Date('2026-03-15T12:00:00Z')

function makePrisma(opts: {
  balance?: number
  monthlyIncome?: number  // will be doubled for 2-month sum
  thisMonthSpend?: number
  subscriptions?: number[]
}) {
  const { balance = 1000, monthlyIncome = 3000, thisMonthSpend = 2000, subscriptions = [] } = opts

  let aggregateCall = 0
  return {
    account: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { currentBalance: balance } }),
    },
    transaction: {
      aggregate: vi.fn().mockImplementation(() => {
        aggregateCall++
        if (aggregateCall === 1) return Promise.resolve({ _sum: { amount: monthlyIncome * 2 } }) // 2-month income
        return Promise.resolve({ _sum: { amount: -thisMonthSpend } })
      }),
    },
    recurringPayment: {
      findMany: vi.fn().mockResolvedValue(subscriptions.map(a => ({ averageAmount: -a }))),
    },
  } as unknown as PrismaClient
}

describe('getCreditHealthReport', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('always includes electoral roll tip', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({})
    const report = await getCreditHealthReport(prisma, 'u1')
    expect(report.tips.some(t => t.title.includes('electoral roll'))).toBe(true)
  })

  it('flags needs_attention when balance is negative', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ balance: -50 })
    const report = await getCreditHealthReport(prisma, 'u1')
    expect(report.score).toBe('needs_attention')
    expect(report.tips.some(t => t.priority === 'high' && /overdrawn/i.test(t.title))).toBe(true)
  })

  it('flags high subscription burden', async () => {
    vi.setSystemTime(NOW)
    // Income 3000, subs 600 = 20% (>15%)
    const prisma = makePrisma({ monthlyIncome: 3000, subscriptions: [600] })
    const report = await getCreditHealthReport(prisma, 'u1')
    expect(report.tips.some(t => /subscription/i.test(t.title))).toBe(true)
  })

  it('flags high spend-to-income ratio', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ monthlyIncome: 3000, thisMonthSpend: 2900 })
    const report = await getCreditHealthReport(prisma, 'u1')
    expect(report.tips.some(t => /spend-to-income/i.test(t.title))).toBe(true)
  })

  it('gives strong score when no high-priority tips', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ balance: 2000, monthlyIncome: 3000, thisMonthSpend: 1500 })
    const report = await getCreditHealthReport(prisma, 'u1')
    expect(report.score).toBe('strong')
  })
})

describe('formatCreditHealthReport', () => {
  it('shows score label and tips', () => {
    const out = formatCreditHealthReport({
      score: 'moderate',
      tips: [
        { priority: 'high', emoji: '🗳️', title: 'Register on the electoral roll', detail: 'Register at gov.uk.' },
        { priority: 'low', emoji: '💳', title: 'Keep utilisation below 30%', detail: 'Use less than 30%.' },
      ],
    })
    expect(out).toMatch(/Moderate/i)
    expect(out).toMatch(/electoral roll/)
    expect(out).toMatch(/qualified adviser/i)
  })

  it('shows needs_attention label', () => {
    const out = formatCreditHealthReport({
      score: 'needs_attention',
      tips: [{ priority: 'high', emoji: '🚨', title: 'Overdrawn', detail: 'Clear it.' }],
    })
    expect(out).toMatch(/Needs attention/i)
  })
})
