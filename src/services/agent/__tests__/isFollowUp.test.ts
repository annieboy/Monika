import { describe, it, expect } from 'vitest'
import { isFollowUp } from '../router.js'

describe('isFollowUp', () => {
  it('treats connective openers as follow-ups', () => {
    expect(isFollowUp('what about last month?')).toBe(true)
    expect(isFollowUp('and at Tesco?')).toBe(true)
    expect(isFollowUp('how about yesterday')).toBe(true)
    expect(isFollowUp('and the total?')).toBe(true)
    expect(isFollowUp('compared to last year')).toBe(true)
  })

  it('treats short context-dependent fragments as follow-ups', () => {
    expect(isFollowUp('last month?')).toBe(true)
    expect(isFollowUp('this week')).toBe(true)
    expect(isFollowUp('that one')).toBe(true)
  })

  it('treats short interrogative follow-ups as follow-ups', () => {
    expect(isFollowUp('what subscription?')).toBe(true)
    expect(isFollowUp('which merchant?')).toBe(true)
    expect(isFollowUp('what was it?')).toBe(true)
    expect(isFollowUp('which one?')).toBe(true)
    expect(isFollowUp('what for?')).toBe(true)
  })

  it('does NOT treat self-contained questions as follow-ups', () => {
    expect(isFollowUp('how much did I spend on groceries this month?')).toBe(false)
    expect(isFollowUp('how much did I spend yesterday?')).toBe(false)
    expect(isFollowUp('what is my balance?')).toBe(false)
    expect(isFollowUp("what's my balance?")).toBe(false)
    expect(isFollowUp('can I afford a mortgage?')).toBe(false)
    expect(isFollowUp('show me my transactions at Tesco last month')).toBe(false)
    expect(isFollowUp('connect my bank')).toBe(false)
  })
})
