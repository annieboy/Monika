import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { periodToRange } from '../agenticHandler.js'

const FROZEN = new Date('2024-06-15T14:00:00Z') // Saturday

describe('periodToRange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN)
  })
  afterEach(() => vi.useRealTimers())

  it('today starts at midnight of the current day', () => {
    const { from, to, label } = periodToRange('today')
    expect(from.getDate()).toBe(15)
    expect(from.getHours()).toBe(0)
    expect(to.getTime()).toBe(FROZEN.getTime())
    expect(label).toBe('today')
  })

  it('this_week starts on Monday', () => {
    const { from } = periodToRange('this_week')
    expect(from.getDate()).toBe(10) // Monday before Sat 15th
  })

  it('last_month covers the whole previous calendar month', () => {
    const { from, to } = periodToRange('last_month')
    expect(from.getMonth()).toBe(4) // May
    expect(from.getDate()).toBe(1)
    expect(to.getMonth()).toBe(4)
    expect(to.getDate()).toBe(31)
  })

  it('last_7_days is a rolling window', () => {
    const { from } = periodToRange('last_7_days')
    expect(from.getTime()).toBe(FROZEN.getTime() - 7 * 86_400_000)
  })

  it('defaults to this_month when period is undefined', () => {
    const { from, label } = periodToRange(undefined)
    expect(from.getDate()).toBe(1)
    expect(from.getMonth()).toBe(5)
    expect(label).toBe('this month')
  })
})
