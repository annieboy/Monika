import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { runMonthlyAggregationBatch } from '../monthlyAggregationService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const NOW = new Date('2026-03-15T10:00:00Z')

function makePrisma(opts: {
  users?: Array<{ id: string }>
  failOnNthAggregate?: number
}) {
  const { users = [{ id: 'u1' }], failOnNthAggregate } = opts

  let aggregateCallCount = 0
  const upsertMock = vi.fn().mockResolvedValue({})

  return {
    user: {
      findMany: vi.fn().mockResolvedValue(users),
    },
    transaction: {
      aggregate: vi.fn().mockImplementation(() => {
        aggregateCallCount++
        if (failOnNthAggregate !== undefined && aggregateCallCount >= failOnNthAggregate) {
          return Promise.reject(new Error('DB error'))
        }
        // Alternate between debit and credit aggregates
        if (aggregateCallCount % 4 === 1 || aggregateCallCount % 4 === 3) {
          return Promise.resolve({ _sum: { amount: '-300' }, _count: { id: 10 } })
        }
        return Promise.resolve({ _sum: { amount: '2000' }, _count: { id: 2 } })
      }),
      groupBy: vi.fn().mockResolvedValue([
        { category: 'groceries', _sum: { amount: '-120' } },
        { category: 'dining', _sum: { amount: '-180' } },
      ]),
      count: vi.fn().mockResolvedValue(12),
    },
    monthlySummary: {
      upsert: upsertMock,
    },
  } as unknown as PrismaClient & { monthlySummary: { upsert: ReturnType<typeof vi.fn> } }
}

describe('runMonthlyAggregationBatch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns aggregated: 1 for a single user', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma({})
    const result = await runMonthlyAggregationBatch(prisma)
    expect(result.aggregated).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('upserts two months (current + prior) per user', async () => {
    vi.setSystemTime(NOW)
    const p = makePrisma({})
    await runMonthlyAggregationBatch(p)
    const upsertCalls = (p as unknown as { monthlySummary: { upsert: ReturnType<typeof vi.fn> } }).monthlySummary.upsert.mock.calls
    expect(upsertCalls.length).toBe(2)
  })

  it('upserts current and prior year-month strings for March 2026', async () => {
    vi.setSystemTime(NOW) // 2026-03-15
    const p = makePrisma({})
    await runMonthlyAggregationBatch(p)
    const calls = (p as unknown as { monthlySummary: { upsert: ReturnType<typeof vi.fn> } }).monthlySummary.upsert.mock.calls
     
    const yearMonths = calls.map((c: any[]) => (c[0] as { where: { userId_yearMonth: { yearMonth: string } } }).where.userId_yearMonth.yearMonth)
    expect(yearMonths).toContain('2026-03')
    expect(yearMonths).toContain('2026-02')
  })

  it('handles January → prior month is December of prior year', async () => {
    vi.setSystemTime(new Date('2026-01-10T10:00:00Z'))
    const p = makePrisma({})
    await runMonthlyAggregationBatch(p)
    const calls = (p as unknown as { monthlySummary: { upsert: ReturnType<typeof vi.fn> } }).monthlySummary.upsert.mock.calls
     
    const yearMonths = calls.map((c: any[]) => (c[0] as { where: { userId_yearMonth: { yearMonth: string } } }).where.userId_yearMonth.yearMonth)
    expect(yearMonths).toContain('2026-01')
    expect(yearMonths).toContain('2025-12')
  })

  it('totalSpend is absolute value', async () => {
    vi.setSystemTime(NOW)
    const p = makePrisma({})
    await runMonthlyAggregationBatch(p)
    const calls = (p as unknown as { monthlySummary: { upsert: ReturnType<typeof vi.fn> } }).monthlySummary.upsert.mock.calls
     
    const totalSpend = (calls[0] as any[])[0].create.totalSpend as number
    expect(totalSpend).toBeGreaterThanOrEqual(0)
  })

  it('returns errors: 1 when one user throws', async () => {
    vi.setSystemTime(NOW)
    const p = makePrisma({ users: [{ id: 'u1' }, { id: 'u2' }], failOnNthAggregate: 5 })
    const result = await runMonthlyAggregationBatch(p)
    expect(result.errors).toBeGreaterThan(0)
  })

  it('returns aggregated: 0 when no users have active connections', async () => {
    vi.setSystemTime(NOW)
    const p = makePrisma({ users: [] })
    const result = await runMonthlyAggregationBatch(p)
    expect(result.aggregated).toBe(0)
    const calls = (p as unknown as { monthlySummary: { upsert: ReturnType<typeof vi.fn> } }).monthlySummary.upsert.mock.calls
    expect(calls.length).toBe(0)
  })
})
