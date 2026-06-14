import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCashFlowForecast, formatCashFlowForecast } from '../cashFlowService.js'

const NOW = new Date('2026-03-15T12:00:00Z')

function makePrisma(opts: {
  balance?: number
  lastSalaryDate?: Date | null
  recurring?: number[]   // absolute monthly amounts (positive)
} = {}) {
  const { balance = 1000, lastSalaryDate = undefined, recurring = [] } = opts

  return {
    account: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { currentBalance: balance } }),
    },
    transaction: {
      findFirst: vi.fn().mockResolvedValue(
        lastSalaryDate === null ? null : { transactionDate: lastSalaryDate ?? new Date('2026-03-01') },
      ),
    },
    recurringPayment: {
      findMany: vi.fn().mockResolvedValue(recurring.map(a => ({ averageAmount: -a, merchantName: 'Merchant' }))),
    },
  } as unknown as PrismaClient
}

describe('getCashFlowForecast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns current balance from accounts', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ balance: 2500, lastSalaryDate: null, recurring: [] })
    const f = await getCashFlowForecast(prisma, 'u1')
    expect(f.currentBalance).toBe(2500)
  })

  it('estimates next payday one month after last salary', async () => {
    vi.setSystemTime(NOW) // 15 March
    const prisma = makePrisma({ lastSalaryDate: new Date('2026-03-01') })
    const f = await getCashFlowForecast(prisma, 'u1')
    expect(f.nextPayday?.getMonth()).toBe(3) // April = 3
    expect(f.nextPayday?.getDate()).toBe(1)
    expect(f.daysUntilPayday).toBeGreaterThan(0)
  })

  it('returns null payday when no salary found', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ lastSalaryDate: null })
    const f = await getCashFlowForecast(prisma, 'u1')
    expect(f.nextPayday).toBeNull()
    expect(f.daysUntilPayday).toBeNull()
  })

  it('detects shortfall when committed exceeds balance', async () => {
    vi.setSystemTime(NOW)
    // £300 balance, payday in 17 days, £600/mo recurring → ~£340 prorated
    const prisma = makePrisma({ balance: 300, lastSalaryDate: new Date('2026-03-01'), recurring: [600] })
    const f = await getCashFlowForecast(prisma, 'u1')
    expect(f.isShortfall).toBe(true)
    expect(f.shortfallAmount).toBeGreaterThan(0)
  })

  it('no shortfall when balance comfortably covers committed', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ balance: 5000, lastSalaryDate: new Date('2026-03-01'), recurring: [200] })
    const f = await getCashFlowForecast(prisma, 'u1')
    expect(f.isShortfall).toBe(false)
    expect(f.shortfallAmount).toBe(0)
  })

  it('counts recurring payments', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({ lastSalaryDate: new Date('2026-03-01'), recurring: [50, 15, 10] })
    const f = await getCashFlowForecast(prisma, 'u1')
    expect(f.recurringCount).toBe(3)
  })
})

describe('formatCashFlowForecast', () => {
  it('shows shortfall warning when projected balance is negative', () => {
    const out = formatCashFlowForecast({
      currentBalance: 300,
      upcomingCommitted: 500,
      projectedBalance: -200,
      daysUntilPayday: 10,
      nextPayday: new Date('2026-03-25'),
      isShortfall: true,
      shortfallAmount: 200,
      recurringCount: 3,
    })
    expect(out).toMatch(/shortfall/i)
    expect(out).toMatch(/£200/)
    expect(out).toMatch(/10 days/)
  })

  it('shows comfortable message when no shortfall', () => {
    const out = formatCashFlowForecast({
      currentBalance: 2000,
      upcomingCommitted: 300,
      projectedBalance: 1700,
      daysUntilPayday: 15,
      nextPayday: new Date('2026-03-30'),
      isShortfall: false,
      shortfallAmount: 0,
      recurringCount: 2,
    })
    expect(out).toMatch(/comfortable/i)
    expect(out).not.toMatch(/shortfall/i)
  })

  it('omits payday line when not known', () => {
    const out = formatCashFlowForecast({
      currentBalance: 1000,
      upcomingCommitted: 200,
      projectedBalance: 800,
      daysUntilPayday: null,
      nextPayday: null,
      isShortfall: false,
      shortfallAmount: 0,
      recurringCount: 1,
    })
    expect(out).not.toMatch(/payday/i)
  })
})
