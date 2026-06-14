import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getFinancialHealthScore, formatFinancialHealthScore } from '../financialHealthService.js'

function makePrisma(opts: {
  monthlyIncome?: number
  thisMonthSpend?: number
  lastMonthSpend?: number
  totalBalance?: number
  subscriptions?: number[]
  budgets?: Array<{ category: string; amount: number }>
  categorySpendThisMonth?: Array<{ category: string; amount: number }>
} = {}) {
  const { monthlyIncome = 0, thisMonthSpend = 0, lastMonthSpend = 0, totalBalance = 0 } = opts

  // Build budget rows as auditLog events
  const budgetRows = (opts.budgets ?? []).map(b => ({
    eventData: { category: b.category, amount: b.amount },
  }))

  const categorySpendRows = (opts.categorySpendThisMonth ?? []).map(r => ({
    category: r.category,
    _sum: { amount: -r.amount },
  }))

  let aggregateCall = 0

  return {
    transaction: {
      aggregate: vi.fn().mockImplementation(() => {
        aggregateCall++
        if (aggregateCall === 1) return Promise.resolve({ _sum: { amount: monthlyIncome } })  // income
        if (aggregateCall === 2) return Promise.resolve({ _sum: { amount: -thisMonthSpend } }) // this month
        return Promise.resolve({ _sum: { amount: -lastMonthSpend } }) // last month
      }),
      groupBy: vi.fn().mockResolvedValue(categorySpendRows),
    },
    account: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { currentBalance: totalBalance } }),
    },
    recurringPayment: {
      findMany: vi.fn().mockResolvedValue(
        (opts.subscriptions ?? []).map(a => ({ averageAmount: -a })),
      ),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue(budgetRows),
    },
  } as unknown as PrismaClient
}

describe('getFinancialHealthScore', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('scores 100 for ideal financial profile', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const prisma = makePrisma({
      monthlyIncome: 4000,
      thisMonthSpend: 1500,
      lastMonthSpend: 1500,
      totalBalance: 9000,   // 6 months buffer
      subscriptions: [200], // 5% of income
      budgets: [{ category: 'eating out', amount: 300 }],
      categorySpendThisMonth: [{ category: 'eating out', amount: 200 }], // under budget
    })
    const score = await getFinancialHealthScore(prisma, 'user-1')
    expect(score.total).toBeGreaterThanOrEqual(80)
    expect(score.band).toBe('excellent')
  })

  it('gives partial savings score when no income detected', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const prisma = makePrisma({ monthlyIncome: 0, lastMonthSpend: 1000, totalBalance: 2000 })
    const score = await getFinancialHealthScore(prisma, 'user-1')
    expect(score.savingsRate).toBe(15) // neutral when no income
    expect(score.inputs.savingsRatePct).toBeNull()
  })

  it('gives partial budget score when no budgets set', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const prisma = makePrisma({ monthlyIncome: 3000, lastMonthSpend: 2000 })
    const score = await getFinancialHealthScore(prisma, 'user-1')
    expect(score.budgetAdherence).toBe(12)
    expect(score.inputs.budgetsSet).toBe(0)
  })

  it('penalises exceeded budgets', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const prisma = makePrisma({
      monthlyIncome: 3000,
      budgets: [
        { category: 'eating out', amount: 100 },
        { category: 'groceries', amount: 200 },
      ],
      categorySpendThisMonth: [
        { category: 'eating out', amount: 200 }, // over
        { category: 'groceries', amount: 150 },  // under
      ],
    })
    const score = await getFinancialHealthScore(prisma, 'user-1')
    // 1/2 budgets on track → 50% adherence → ~12/25
    expect(score.budgetAdherence).toBeLessThan(20)
    expect(score.inputs.budgetsExceeded).toBe(1)
  })

  it('sets band to needs_work for very low score', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const prisma = makePrisma({
      monthlyIncome: 3000,
      thisMonthSpend: 3500,
      lastMonthSpend: 1000,
      totalBalance: 0,
      subscriptions: [600], // 20% of income
    })
    const score = await getFinancialHealthScore(prisma, 'user-1')
    expect(score.total).toBeLessThan(60)
  })
})

describe('formatFinancialHealthScore', () => {
  it('includes score, band label, and component breakdown', () => {
    const out = formatFinancialHealthScore({
      total: 75,
      savingsRate: 22,
      budgetAdherence: 20,
      balanceBuffer: 15,
      spendingStability: 12,
      subscriptionRatio: 6,
      band: 'good',
      inputs: {
        savingsRatePct: 0.18,
        budgetsSet: 3,
        budgetsExceeded: 0,
        monthsOfExpensesCovered: 2.2,
        spendChangePct: 0.05,
        subscriptionsPct: 0.08,
        monthlyIncome: 3000,
      },
    })
    expect(out).toMatch(/75\/100/)
    expect(out).toMatch(/Good/i)
    expect(out).toMatch(/Savings rate/)
    expect(out).toMatch(/Budget adherence/)
    expect(out).toMatch(/financial advice/i)
  })

  it('shows red band for needs_work', () => {
    const out = formatFinancialHealthScore({
      total: 30,
      savingsRate: 5,
      budgetAdherence: 5,
      balanceBuffer: 5,
      spendingStability: 8,
      subscriptionRatio: 7,
      band: 'needs_work',
      inputs: {
        savingsRatePct: 0.02,
        budgetsSet: 0,
        budgetsExceeded: 0,
        monthsOfExpensesCovered: 0.3,
        spendChangePct: null,
        subscriptionsPct: null,
        monthlyIncome: 0,
      },
    })
    expect(out).toContain('🔴')
    expect(out).toMatch(/Needs work/i)
  })
})
