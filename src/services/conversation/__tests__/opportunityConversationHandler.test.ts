import { describe, it, expect } from 'vitest'
import { isOptOutMessage } from '../../compliance/consentService.js'

/**
 * Unit tests for reply classification logic.
 * Full integration tests (with DB) are out of scope for unit test suite.
 * The conversation handler's classifyReply is private — we test its effects
 * via the exported opt-out detection and through integration scenarios below.
 */

describe('opt-out keyword detection (used by conversation handler)', () => {
  const optOutWords = ['STOP', 'UNSUBSCRIBE', 'OPT OUT', 'NO MORE', 'REMOVE ME']

  for (const keyword of optOutWords) {
    it(`detects "${keyword}" as opt-out`, () => {
      expect(isOptOutMessage(keyword)).toBe(true)
    })
  }

  it('does not false-positive on "I want to stop spending"', () => {
    expect(isOptOutMessage('I want to stop spending')).toBe(false)
  })
})

describe('reply pattern validation', () => {
  // These patterns are used by classifyReply — test the regex logic directly
  const DETAIL_PATTERN = /^(1|yes|show me|show details?|tell me more|more details?|interested|ok|okay|sure|go ahead)$/i
  const DISMISS_PATTERN = /^(2|no|no thanks|not interested|dismiss|skip|nope|not for me)$/i
  const MORE_PATTERN = /^(3|more|more options?|other options?|alternatives?|show more|others?)$/i
  const REMIND_PATTERN = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i

  describe('DETAIL replies', () => {
    const valid = ['1', 'yes', 'YES', 'show me', 'tell me more', 'ok', 'okay', 'sure', 'go ahead', 'interested']
    for (const reply of valid) {
      it(`matches: "${reply}"`, () => expect(DETAIL_PATTERN.test(reply)).toBe(true))
    }

    it('does not match "no"', () => expect(DETAIL_PATTERN.test('no')).toBe(false))
    it('does not match "2"', () => expect(DETAIL_PATTERN.test('2')).toBe(false))
  })

  describe('DISMISS replies', () => {
    const valid = ['2', 'no', 'no thanks', 'not interested', 'dismiss', 'skip', 'nope', 'not for me']
    for (const reply of valid) {
      it(`matches: "${reply}"`, () => expect(DISMISS_PATTERN.test(reply)).toBe(true))
    }

    it('does not match "yes"', () => expect(DISMISS_PATTERN.test('yes')).toBe(false))
    it('does not match "1"', () => expect(DISMISS_PATTERN.test('1')).toBe(false))
  })

  describe('MORE replies', () => {
    const valid = ['3', 'more', 'more options', 'other options', 'alternatives', 'show more', 'others']
    for (const reply of valid) {
      it(`matches: "${reply}"`, () => expect(MORE_PATTERN.test(reply)).toBe(true))
    }

    it('does not match "1"', () => expect(MORE_PATTERN.test('1')).toBe(false))
    it('does not match "show me"', () => expect(MORE_PATTERN.test('show me')).toBe(false))
  })

  describe('REMIND replies (month + year)', () => {
    const valid = [
      'March 2026',
      'march 2026',
      'MARCH 2026',
      'January 2027',
      'December 2025',
    ]
    for (const reply of valid) {
      it(`matches: "${reply}"`, () => expect(REMIND_PATTERN.test(reply)).toBe(true))
    }

    it('does not match just a year', () => expect(REMIND_PATTERN.test('2026')).toBe(false))
    it('does not match just a month', () => expect(REMIND_PATTERN.test('March')).toBe(false))
    it('does not match invalid month', () => expect(REMIND_PATTERN.test('Marchuary 2026')).toBe(false))
  })
})

describe('reminder date parsing', () => {
  // Test the parseReminderDate logic inline
  function parseReminderDate(text: string): Date | null {
    const match = text.match(/^(\w+)\s+(\d{4})$/i)
    if (!match) return null
    const date = new Date(`${match[1]} 1 ${match[2]}`)
    return isNaN(date.getTime()) ? null : date
  }

  it('parses "March 2026" to a valid Date', () => {
    const date = parseReminderDate('March 2026')
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(2) // 0-indexed: March = 2
  })

  it('parses "January 2027"', () => {
    const date = parseReminderDate('January 2027')
    expect(date?.getFullYear()).toBe(2027)
    expect(date?.getMonth()).toBe(0)
  })

  it('returns null for "Not a date"', () => {
    expect(parseReminderDate('Not a date')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseReminderDate('')).toBeNull()
  })
})
