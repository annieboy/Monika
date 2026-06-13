/**
 * OAuth state encode/decode tests.
 *
 * The signed state parameter prevents CSRF in the TrueLayer OAuth flow.
 * Regressions here mean an attacker could forge callbacks and hijack bank connections.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { encodeOAuthState, decodeOAuthState } from '../oauth-state.js'

const SECRET = 'test-secret-32-chars-minimum-len'
const USER_ID = '00000000-0000-0000-0000-000000000001'

describe('encodeOAuthState / decodeOAuthState', () => {
  afterEach(() => vi.useRealTimers())

  it('round-trips a valid userId', () => {
    const state = encodeOAuthState(USER_ID, SECRET)
    expect(decodeOAuthState(state, SECRET)).toBe(USER_ID)
  })

  it('returns null for an empty string', () => {
    expect(decodeOAuthState('', SECRET)).toBeNull()
  })

  it('returns null when secret is wrong (HMAC mismatch)', () => {
    const state = encodeOAuthState(USER_ID, SECRET)
    expect(decodeOAuthState(state, 'wrong-secret')).toBeNull()
  })

  it('returns null when state is tampered after encoding', () => {
    const state = encodeOAuthState(USER_ID, SECRET)
    // Decode, flip a character in the payload, re-encode
    const decoded = Buffer.from(state, 'base64url').toString('utf-8')
    const tampered = decoded.slice(0, 5) + 'X' + decoded.slice(6)
    const tamperedState = Buffer.from(tampered).toString('base64url')
    expect(decodeOAuthState(tamperedState, SECRET)).toBeNull()
  })

  it('returns null when state is expired (>15 minutes old)', () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(now)

    const state = encodeOAuthState(USER_ID, SECRET)

    // Advance 16 minutes
    vi.setSystemTime(now + 16 * 60 * 1000)
    expect(decodeOAuthState(state, SECRET)).toBeNull()
  })

  it('accepts state created 14 minutes ago (within window)', () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(now)

    const state = encodeOAuthState(USER_ID, SECRET)

    vi.setSystemTime(now + 14 * 60 * 1000)
    expect(decodeOAuthState(state, SECRET)).toBe(USER_ID)
  })

  it('produces different state tokens on every call (random nonce)', () => {
    const s1 = encodeOAuthState(USER_ID, SECRET)
    const s2 = encodeOAuthState(USER_ID, SECRET)
    expect(s1).not.toBe(s2)
  })

  it('returns null for arbitrary garbage input', () => {
    expect(decodeOAuthState('not-valid-base64url!@#', SECRET)).toBeNull()
    expect(decodeOAuthState('validBase64ButWrongStructure', SECRET)).toBeNull()
  })

  it('never throws — always returns string or null', () => {
    expect(() => decodeOAuthState('garbage', SECRET)).not.toThrow()
    expect(() => decodeOAuthState('', '')).not.toThrow()
  })
})
