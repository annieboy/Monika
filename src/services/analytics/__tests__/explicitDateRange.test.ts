import { describe, it, expect } from 'vitest'
import { extractExplicitDateRange, extractQueryContext } from '../context.js'

// Fixed reference point: Saturday 14 November 2026.
const NOW = new Date(2026, 10, 14, 12, 0, 0)

const ymd = (d: Date): [number, number, number] => [d.getFullYear(), d.getMonth(), d.getDate()]

describe('extractExplicitDateRange', () => {
  it('parses an ISO date as a single day', () => {
    const r = extractExplicitDateRange('what did I spend on 2026-11-03?', NOW)!
    expect(r).not.toBeNull()
    expect(ymd(r.fromDate)).toEqual([2026, 10, 3])
    expect(ymd(r.toDate)).toEqual([2026, 10, 3])
    expect(r.toDate.getHours()).toBe(23) // inclusive end of day
  })

  it('parses a month range "between June and August"', () => {
    const r = extractExplicitDateRange('how much between June and August', NOW)!
    expect(ymd(r.fromDate)).toEqual([2026, 5, 1])
    expect(ymd(r.toDate)).toEqual([2026, 7, 31])
  })

  it('parses "5 November" / "5th of Nov 2025" / "November 5"', () => {
    expect(ymd(extractExplicitDateRange('spend on 5 November', NOW)!.fromDate)).toEqual([2026, 10, 5])
    expect(ymd(extractExplicitDateRange('on 5th of Nov 2025', NOW)!.fromDate)).toEqual([2025, 10, 5])
    expect(ymd(extractExplicitDateRange('November 5', NOW)!.fromDate)).toEqual([2026, 10, 5])
  })

  it('parses a UK numeric date 12/11 and 12/11/2025', () => {
    expect(ymd(extractExplicitDateRange('on 12/11', NOW)!.fromDate)).toEqual([2026, 10, 12])
    expect(ymd(extractExplicitDateRange('on 12/11/2025', NOW)!.fromDate)).toEqual([2025, 10, 12])
  })

  it('parses a whole named month ("in October", "last October")', () => {
    const r = extractExplicitDateRange('how much did I spend in October', NOW)!
    expect(ymd(r.fromDate)).toEqual([2026, 9, 1])
    expect(ymd(r.toDate)).toEqual([2026, 9, 31])
    expect(ymd(extractExplicitDateRange('last October', NOW)!.fromDate)).toEqual([2026, 9, 1])
  })

  it('parses a bare day-of-month, using last month when the day is still ahead', () => {
    // the 3rd already happened this month → this month
    expect(ymd(extractExplicitDateRange('on the 3rd', NOW)!.fromDate)).toEqual([2026, 10, 3])
    // the 21st is still ahead in November → previous month (October)
    expect(ymd(extractExplicitDateRange('the 21st', NOW)!.fromDate)).toEqual([2026, 9, 21])
  })

  it('clamps the end of an in-progress period to now', () => {
    const r = extractExplicitDateRange('in November', NOW)!
    expect(ymd(r.fromDate)).toEqual([2026, 10, 1])
    expect(r.toDate.getTime()).toBe(NOW.getTime())
  })

  it('does NOT misread the modal "this may be ..." as the month of May', () => {
    expect(extractExplicitDateRange('this may be a big month', NOW)).toBeNull()
  })

  it('returns null for relative phrases and plain questions (fall through to period logic)', () => {
    for (const msg of ['last month', 'this week', 'yesterday', 'last 7 days', "what's my balance", 'how much did I spend']) {
      expect(extractExplicitDateRange(msg, NOW)).toBeNull()
    }
  })

  it('does not trigger on amounts or count phrases', () => {
    expect(extractExplicitDateRange('I spent £1200 somewhere', NOW)).toBeNull()
    expect(extractExplicitDateRange('over the last 3 months', NOW)).toBeNull()
  })
})

describe('extractQueryContext uses explicit dates over relative defaults', () => {
  it('routes "in October" to October, not the current month', () => {
    const ctx = extractQueryContext('how much did I spend in October')
    // Only assert the month/day shape is October (year depends on real "now"),
    // which is what distinguishes it from the current-month default.
    expect(ctx.fromDate.getMonth()).toBe(9)
    expect(ctx.fromDate.getDate()).toBe(1)
  })
})
