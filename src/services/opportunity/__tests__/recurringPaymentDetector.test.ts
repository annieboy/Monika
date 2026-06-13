import { describe, it, expect, vi } from 'vitest'
import { detectCadence, computeAmountStats, detectRecurringPayments } from '../recurringPaymentDetector.js'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

describe('detectCadence', () => {
  function datesFromGaps(startDate: Date, gapDays: number[]): Date[] {
    const dates = [startDate]
    for (const gap of gapDays) {
      const prev = dates[dates.length - 1]!
      dates.push(new Date(prev.getTime() + gap * 86_400_000))
    }
    return dates
  }

  it('detects monthly cadence with consistent 30-day gaps', () => {
    const dates = datesFromGaps(new Date('2025-01-01'), [30, 30, 30, 30, 30])
    const result = detectCadence(dates)
    expect(result.cadence).toBe('monthly')
    expect(result.cadenceConfidence).toBeGreaterThan(0.9)
  })

  it('detects monthly cadence with slight drift (28–31 days)', () => {
    const dates = datesFromGaps(new Date('2025-01-01'), [31, 28, 31, 30, 31])
    const result = detectCadence(dates)
    expect(result.cadence).toBe('monthly')
    expect(result.cadenceConfidence).toBeGreaterThan(0.6)
  })

  it('detects weekly cadence', () => {
    const dates = datesFromGaps(new Date('2025-01-01'), [7, 7, 7, 7, 7])
    const result = detectCadence(dates)
    expect(result.cadence).toBe('weekly')
    expect(result.cadenceConfidence).toBeGreaterThan(0.9)
  })

  it('detects annual cadence', () => {
    const dates = datesFromGaps(new Date('2023-01-01'), [365, 365])
    const result = detectCadence(dates)
    expect(result.cadence).toBe('annual')
  })

  it('detects quarterly cadence', () => {
    const dates = datesFromGaps(new Date('2025-01-01'), [91, 91, 91])
    const result = detectCadence(dates)
    expect(result.cadence).toBe('quarterly')
  })

  it('returns irregular for random gaps', () => {
    const dates = datesFromGaps(new Date('2025-01-01'), [5, 45, 12, 80])
    const result = detectCadence(dates)
    expect(result.cadence).toBe('irregular')
  })

  it('returns irregular with low confidence for only 2 dates', () => {
    const result = detectCadence([new Date('2025-01-01')])
    expect(result.cadence).toBe('irregular')
    expect(result.cadenceConfidence).toBe(0)
  })

  it('confidence is lower when gap variance is high', () => {
    const consistent = datesFromGaps(new Date('2025-01-01'), [30, 30, 30, 30])
    const variable = datesFromGaps(new Date('2025-01-01'), [25, 35, 27, 33])

    const confConsistent = detectCadence(consistent).cadenceConfidence
    const confVariable = detectCadence(variable).cadenceConfidence

    expect(confConsistent).toBeGreaterThan(confVariable)
  })
})

describe('computeAmountStats', () => {
  it('computes correct average', () => {
    const stats = computeAmountStats([10, 20, 30])
    expect(stats.averageAmount).toBeCloseTo(20)
  })

  it('computes correct min and max', () => {
    const stats = computeAmountStats([15, 25, 5, 30])
    expect(stats.minAmount).toBe(5)
    expect(stats.maxAmount).toBe(30)
  })

  it('stdDev is 0 for identical amounts (perfect subscription)', () => {
    const stats = computeAmountStats([49.99, 49.99, 49.99, 49.99])
    expect(stats.stdDev).toBeCloseTo(0)
  })

  it('stdDev is non-zero for varied amounts', () => {
    const stats = computeAmountStats([10, 50, 100])
    expect(stats.stdDev).toBeGreaterThan(0)
  })

  it('variance ratio flags high-variance as non-subscription', () => {
    const stats = computeAmountStats([10, 200, 5, 300])
    const varianceRatio = stats.stdDev / stats.averageAmount
    expect(varianceRatio).toBeGreaterThan(0.20) // should be filtered out
  })

  it('variance ratio is low for typical subscription', () => {
    // Netflix varies slightly due to currency/VAT changes
    const stats = computeAmountStats([17.99, 17.99, 18.99, 17.99])
    const varianceRatio = stats.stdDev / stats.averageAmount
    expect(varianceRatio).toBeLessThan(0.10)
  })
})

// ---------------------------------------------------------------------------
// detectRecurringPayments
// ---------------------------------------------------------------------------

function makeTxn(merchantName: string, amount: number, daysAgo: number, overrides: Record<string, unknown> = {}) {
  return {
    merchantName,
    merchantNameClean: null as string | null,
    rawDescription: `DESC ${merchantName}`,
    amount: new Decimal(-Math.abs(amount)), // outgoing = negative
    transactionDate: new Date(Date.now() - daysAgo * 86_400_000),
    currency: 'GBP',
    category: 'subscriptions',
    status: 'settled',
    ...overrides,
  }
}

function buildPrisma(txns: ReturnType<typeof makeTxn>[]) {
  const upsert = vi.fn().mockResolvedValue({})
  const findMany = vi.fn().mockResolvedValue(txns)
  return {
    transaction: { findMany },
    recurringPayment: { upsert },
  } as unknown as PrismaClient
}

describe('detectRecurringPayments', () => {
  it('returns 0 when no transactions', async () => {
    const prisma = buildPrisma([])
    const result = await detectRecurringPayments(prisma, 'user-1')
    expect(result).toBe(0)
    expect((prisma.recurringPayment.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('returns 0 when merchant has only one occurrence', async () => {
    const prisma = buildPrisma([makeTxn('Netflix', 17.99, 10)])
    const result = await detectRecurringPayments(prisma, 'user-1')
    expect(result).toBe(0)
  })

  it('upserts and returns count for a regular merchant with 2+ occurrences', async () => {
    const txns = [
      makeTxn('Netflix', 17.99, 60),
      makeTxn('Netflix', 17.99, 30),
    ]
    const prisma = buildPrisma(txns)
    const result = await detectRecurringPayments(prisma, 'user-1')
    expect(result).toBe(1)
    expect((prisma.recurringPayment.upsert as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })

  it('skips high-variance merchant', async () => {
    // stdDev/avg >> 0.20, so should be filtered
    const txns = [
      makeTxn('RandomShop', 10, 60),
      makeTxn('RandomShop', 200, 30),
    ]
    const prisma = buildPrisma(txns)
    const result = await detectRecurringPayments(prisma, 'user-1')
    expect(result).toBe(0)
    expect((prisma.recurringPayment.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('uses merchantNameClean when available', async () => {
    const txns = [
      makeTxn('netflix inc', 17.99, 60, { merchantNameClean: 'Netflix' }),
      makeTxn('netflix inc', 17.99, 30, { merchantNameClean: 'Netflix' }),
    ]
    const prisma = buildPrisma(txns)
    const result = await detectRecurringPayments(prisma, 'user-1')
    expect(result).toBe(1)
    const upsertCall = (prisma.recurringPayment.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // The merchant name used for grouping/display should come from merchantNameClean
    expect(upsertCall.create.merchantName).toBe('Netflix')
  })

  it('uses rawDescription as fallback when merchantName is null', async () => {
    const txns = [
      makeTxn('ignored', 9.99, 60, { merchantName: null, merchantNameClean: null, rawDescription: 'ACME SUB' }),
      makeTxn('ignored', 9.99, 30, { merchantName: null, merchantNameClean: null, rawDescription: 'ACME SUB' }),
    ]
    const prisma = buildPrisma(txns)
    const result = await detectRecurringPayments(prisma, 'user-1')
    expect(result).toBe(1)
    const upsertCall = (prisma.recurringPayment.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // merchantSlug is derived from rawDescription
    expect(upsertCall.create.merchantSlug).toBeTruthy()
  })
})
