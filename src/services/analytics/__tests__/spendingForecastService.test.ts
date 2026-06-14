import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getSpendingForecast, formatSpendingForecast } from '../spendingForecastService.js'

function makePrisma(opts: {
  thisMonthSpend?: number
  lastMonthSpend?: number
} = {}) {
  let callCount = 0
  return {
    transaction: {
      aggregate: vi.fn().mockImplementation(() => {
        callCount++
        const amount = callCount === 1 ? -(opts.thisMonthSpend ?? 0) : -(opts.lastMonthSpend ?? 0)
        return Promise.resolve({ _sum: { amount } })
      }),
    },
  } as unknown as PrismaClient
}

describe('getSpendingForecast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('calculates daily rate and forecasts to end of month', async () => {
    // Simulate 10th of a 31-day month, £200 spent so far → £20/day → £620 forecast
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'))
    const prisma = makePrisma({ thisMonthSpend: 200, lastMonthSpend: 500 })
    const result = await getSpendingForecast(prisma, 'user-1')
    expect(result.thisMonthSoFar).toBe(200)
    expect(result.dailyRate).toBeCloseTo(20, 0)
    expect(result.forecastedTotal).toBeCloseTo(620, 0)
    expect(result.daysElapsed).toBe(10)
    expect(result.daysInMonth).toBe(31)
  })

  it('computes changeVsLastMonth correctly', async () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const prisma = makePrisma({ thisMonthSpend: 300, lastMonthSpend: 400 })
    const result = await getSpendingForecast(prisma, 'user-1')
    // dailyRate = 300/15 = 20, forecast = 20*31 = 620, change vs 400 = +220
    expect(result.changeVsLastMonth).toBeGreaterThan(0)
  })

  it('returns zero forecast when no transactions', async () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'))
    const prisma = makePrisma({ thisMonthSpend: 0, lastMonthSpend: 0 })
    const result = await getSpendingForecast(prisma, 'user-1')
    expect(result.forecastedTotal).toBe(0)
    expect(result.thisMonthSoFar).toBe(0)
  })
})

describe('formatSpendingForecast', () => {
  it('includes projected total and last month comparison', () => {
    const out = formatSpendingForecast({
      thisMonthSoFar: 300,
      forecastedTotal: 600,
      lastMonthTotal: 500,
      changeVsLastMonth: 100,
      daysElapsed: 15,
      daysInMonth: 30,
      dailyRate: 20,
    })
    expect(out).toMatch(/£600/)
    expect(out).toMatch(/£500/)
    expect(out).toMatch(/up/)
    expect(out).toMatch(/forecast/i)
  })

  it('shows down trend when forecasting less than last month', () => {
    const out = formatSpendingForecast({
      thisMonthSoFar: 100,
      forecastedTotal: 200,
      lastMonthTotal: 400,
      changeVsLastMonth: -200,
      daysElapsed: 10,
      daysInMonth: 30,
      dailyRate: 10,
    })
    expect(out).toMatch(/down/)
  })
})
