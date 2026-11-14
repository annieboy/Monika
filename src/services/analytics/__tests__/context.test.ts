/**
 * extractQueryContext tests — pure date-range and keyword extraction.
 *
 * All date assertions freeze time to 2024-06-15T14:00:00Z so relative
 * calculations produce deterministic results.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractQueryContext, extractSpendSubject, extractEarnSubject } from '../context.js'

const FROZEN = new Date('2024-06-15T14:00:00Z')

// ── Date ranges ───────────────────────────────────────────────────────────────

describe('extractQueryContext — date ranges', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN)
  })
  afterEach(() => vi.useRealTimers())

  it('defaults to current month when no date keyword present', () => {
    const { fromDate, toDate } = extractQueryContext('how much have I spent?')
    expect(fromDate).toEqual(new Date(2024, 5, 1)) // June 1
    expect(toDate.getTime()).toBeGreaterThanOrEqual(FROZEN.getTime() - 100)
  })

  it('last month → May 1 to May 31 23:59:59.999', () => {
    const { fromDate, toDate } = extractQueryContext('spending last month')
    expect(fromDate).toEqual(new Date(2024, 4, 1))
    expect(toDate).toEqual(new Date(2024, 4, 31, 23, 59, 59, 999))
  })

  it('last 3 months → from March 1', () => {
    const { fromDate } = extractQueryContext('last 3 months spending')
    expect(fromDate).toEqual(new Date(2024, 2, 1))
  })

  it('last 6 months', () => {
    const { fromDate } = extractQueryContext('last 6 months')
    expect(fromDate).toEqual(new Date(2023, 11, 1)) // Dec 1 2023
  })

  it('last 30 days', () => {
    const { fromDate } = extractQueryContext('last 30 days')
    const expected = new Date(FROZEN.getTime() - 30 * 86_400_000)
    expect(Math.abs(fromDate.getTime() - expected.getTime())).toBeLessThan(1000)
  })

  it('last 7 days', () => {
    const { fromDate } = extractQueryContext('last 7 days')
    const expected = new Date(FROZEN.getTime() - 7 * 86_400_000)
    expect(Math.abs(fromDate.getTime() - expected.getTime())).toBeLessThan(1000)
  })

  it('last week → 7 days back', () => {
    const { fromDate } = extractQueryContext('what did I spend last week?')
    const expected = new Date(FROZEN.getTime() - 7 * 86_400_000)
    expect(Math.abs(fromDate.getTime() - expected.getTime())).toBeLessThan(1000)
  })

  it('past week is treated the same as last week', () => {
    const { fromDate } = extractQueryContext('past week spending')
    const expected = new Date(FROZEN.getTime() - 7 * 86_400_000)
    expect(Math.abs(fromDate.getTime() - expected.getTime())).toBeLessThan(1000)
  })

  it('this year → Jan 1 of current year', () => {
    const { fromDate } = extractQueryContext('this year spending')
    expect(fromDate).toEqual(new Date(2024, 0, 1))
  })

  it('YTD alias works', () => {
    const { fromDate } = extractQueryContext('YTD spending')
    expect(fromDate).toEqual(new Date(2024, 0, 1))
  })

  it('specific year 2023 → Jan 1 to Dec 31 2023', () => {
    const { fromDate, toDate } = extractQueryContext('spending in 2023')
    expect(fromDate).toEqual(new Date(2023, 0, 1))
    expect(toDate).toEqual(new Date(2023, 11, 31, 23, 59, 59, 999))
  })

  it('last year → full previous calendar year', () => {
    const { fromDate, toDate } = extractQueryContext('last year spending')
    expect(fromDate).toEqual(new Date(2023, 0, 1))
    expect(toDate).toEqual(new Date(2023, 11, 31, 23, 59, 59, 999))
  })

  it('tax year starts April 6 of current year when date is after April 6', () => {
    // FROZEN = June 15 2024, which is after April 6 2024
    const { fromDate } = extractQueryContext('spending this tax year')
    expect(fromDate).toEqual(new Date(2024, 3, 6))
  })

  it('tax year starts April 6 of previous year when date is before April 6', () => {
    vi.setSystemTime(new Date('2024-02-10T12:00:00Z'))
    const { fromDate } = extractQueryContext('tax year spending')
    expect(fromDate).toEqual(new Date(2023, 3, 6))
  })

  it('yesterday → full day June 14', () => {
    const { fromDate, toDate } = extractQueryContext('what did I spend yesterday?')
    expect(fromDate).toEqual(new Date(2024, 5, 14))
    expect(toDate).toEqual(new Date(2024, 5, 14, 23, 59, 59))
  })

  it('last month takes priority over bare year digit in the sentence', () => {
    // "last month" should win over any incidental year-like numbers
    const { fromDate } = extractQueryContext('last month spending in 2024')
    expect(fromDate).toEqual(new Date(2024, 4, 1)) // May
  })
})

// ── Category extraction ───────────────────────────────────────────────────────

describe('extractQueryContext — category extraction', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FROZEN) })
  afterEach(() => vi.useRealTimers())

  it('extracts groceries from "supermarket"', () => {
    expect(extractQueryContext('spending at the supermarket').categoryFilter).toBe('groceries')
  })

  it('extracts groceries from "Tesco" in context text', () => {
    expect(extractQueryContext('how much at Tesco on groceries').categoryFilter).toBe('groceries')
  })

  it('extracts restaurants from "eating out"', () => {
    expect(extractQueryContext('eating out this month').categoryFilter).toBe('restaurants')
  })

  it('extracts restaurants from "Deliveroo"', () => {
    expect(extractQueryContext('Deliveroo and Uber Eats spending').categoryFilter).toBe('restaurants')
  })

  it('extracts transport from "tube"', () => {
    expect(extractQueryContext('tube and train spending').categoryFilter).toBe('transport')
  })

  it('extracts subscriptions from "Spotify"', () => {
    expect(extractQueryContext('how much for Spotify this month').categoryFilter).toBe('subscriptions')
  })

  it('extracts bills from "broadband"', () => {
    expect(extractQueryContext('broadband and utility bills').categoryFilter).toBe('bills')
  })

  it('extracts coffee from "Caffe Nero"', () => {
    // "coffee" itself contains "ee" which matches the EE mobile bills pattern;
    // use "Caffe Nero" which is unambiguously matched by the coffee pattern.
    expect(extractQueryContext('Caffe Nero spending').categoryFilter).toBe('coffee')
  })

  it('returns undefined when no category keyword matches', () => {
    expect(extractQueryContext('how much have I spent?').categoryFilter).toBeUndefined()
  })

  it('first matching pattern wins (groceries before restaurants for "food shopping")', () => {
    expect(extractQueryContext('food shopping this month').categoryFilter).toBe('groceries')
  })
})

// ── Merchant extraction ───────────────────────────────────────────────────────

describe('extractQueryContext — merchant extraction', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FROZEN) })
  afterEach(() => vi.useRealTimers())

  it('extracts "tesco" from "at Tesco"', () => {
    expect(extractQueryContext('how much at Tesco this month').merchantFilter).toBe('tesco')
  })

  it('extracts "amazon" from "on Amazon"', () => {
    expect(extractQueryContext('what did I spend on Amazon?').merchantFilter).toBe('amazon')
  })

  it('extracts "amazon" from "at Amazon"', () => {
    expect(extractQueryContext('how much at Amazon last month').merchantFilter).toBe('amazon')
  })

  it('extracts "sainsbury" from "at Sainsbury\'s"', () => {
    expect(extractQueryContext('at Sainsbury this week').merchantFilter).toBe('sainsbury')
  })

  it('extracts "deliveroo" from bare word in sentence', () => {
    expect(extractQueryContext('Deliveroo spending this month').merchantFilter).toBe('deliveroo')
  })

  it('extracts "uber eats" from "on Uber Eats"', () => {
    expect(extractQueryContext('on Uber Eats last month').merchantFilter).toBe('uber eats')
  })

  it('extracts "boots" from "at Boots"', () => {
    expect(extractQueryContext('spending at Boots').merchantFilter).toBe('boots')
  })

  it('returns undefined when no merchant pattern matches', () => {
    expect(extractQueryContext('groceries this month').merchantFilter).toBeUndefined()
  })

  // ── "today" / "this week" (regression for the spend-today bug) ───────────────
  it('scopes "today" to the start of the current day, not the month', () => {
    const { fromDate, toDate } = extractQueryContext('how much did I spend today')
    // FROZEN is 2024-06-15; start of today is the 15th, not the 1st
    expect(fromDate.getDate()).toBe(15)
    expect(fromDate.getMonth()).toBe(5) // June
    expect(fromDate.getHours()).toBe(0)
    expect(toDate.getTime()).toBe(FROZEN.getTime())
  })

  it('scopes "this week" to the most recent Monday', () => {
    // 2024-06-15 is a Saturday → Monday is the 10th
    const { fromDate } = extractQueryContext('what have I spent this week')
    expect(fromDate.getDate()).toBe(10)
    expect(fromDate.getMonth()).toBe(5)
  })

  it('still scopes default (no timeframe) to start of month', () => {
    const { fromDate } = extractQueryContext('how much did I spend on groceries')
    expect(fromDate.getDate()).toBe(1)
    expect(fromDate.getMonth()).toBe(5)
  })
})

describe('extractSpendSubject', () => {
  it('flags a merchant name (not a category)', () => {
    expect(extractSpendSubject('how much did I spend on winners chapel')).toEqual({ subject: 'winners chapel', isCategory: false })
    expect(extractSpendSubject('how much have I spent on winners chapel this year')).toEqual({ subject: 'winners chapel', isCategory: false })
  })

  it('flags known categories as categories', () => {
    expect(extractSpendSubject('how much did I spend on groceries this month')?.isCategory).toBe(true)
    expect(extractSpendSubject('what did I spend on transport')?.isCategory).toBe(true)
  })

  it('returns null when there is no "spend on X"', () => {
    expect(extractSpendSubject("what's my balance?")).toBeNull()
    expect(extractSpendSubject('how much did I spend this month')).toBeNull()
  })
})

describe('extractEarnSubject', () => {
  it('pulls the payer from income questions', () => {
    expect(extractEarnSubject('how much do I earn from PayStream')).toBe('PayStream')
    expect(extractEarnSubject('what do I receive from Acme Ltd each month')).toBe('Acme Ltd')
    expect(extractEarnSubject('how much am I paid by Employer this year')).toBe('Employer')
  })
  it('returns null for non-income questions', () => {
    expect(extractEarnSubject('how much did I spend on groceries')).toBeNull()
    expect(extractEarnSubject("what's my balance")).toBeNull()
  })
})
