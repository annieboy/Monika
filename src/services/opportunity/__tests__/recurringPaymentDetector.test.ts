import { describe, it, expect } from 'vitest'
import { detectCadence, computeAmountStats } from '../recurringPaymentDetector.js'

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
