import { describe, it, expect } from 'vitest'
import { isOptOutMessage, OPT_OUT_KEYWORDS } from '../consentService.js'

describe('isOptOutMessage', () => {
  it('detects STOP', () => {
    expect(isOptOutMessage('STOP')).toBe(true)
  })

  it('detects UNSUBSCRIBE', () => {
    expect(isOptOutMessage('UNSUBSCRIBE')).toBe(true)
  })

  it('detects NO MORE', () => {
    expect(isOptOutMessage('NO MORE')).toBe(true)
  })

  it('detects OPT OUT', () => {
    expect(isOptOutMessage('OPT OUT')).toBe(true)
  })

  it('detects REMOVE ME', () => {
    expect(isOptOutMessage('REMOVE ME')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isOptOutMessage('stop')).toBe(true)
    expect(isOptOutMessage('Stop')).toBe(true)
  })

  it('matches keyword at start of message with trailing text', () => {
    expect(isOptOutMessage('STOP please')).toBe(true)
  })

  it('does not false-positive on regular messages', () => {
    expect(isOptOutMessage('Hello Monika')).toBe(false)
    expect(isOptOutMessage('What is my balance?')).toBe(false)
    expect(isOptOutMessage('I want to stop spending so much')).toBe(false)
  })

  it('does not match STOP embedded in a word mid-sentence', () => {
    // "I want to stop spending" — "stop" not at start, so should not match
    expect(isOptOutMessage('I want to stop spending')).toBe(false)
  })

  it('handles empty string without throwing', () => {
    expect(isOptOutMessage('')).toBe(false)
  })

  it('all OPT_OUT_KEYWORDS are detected', () => {
    for (const keyword of OPT_OUT_KEYWORDS) {
      expect(isOptOutMessage(keyword)).toBe(true)
    }
  })
})
