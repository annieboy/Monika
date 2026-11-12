import { describe, it, expect, beforeEach } from 'vitest'
import { allowAgentCall, _resetRateLimiter, AGENT_RATE_LIMIT } from '../rateLimiter.js'

describe('allowAgentCall', () => {
  beforeEach(() => _resetRateLimiter())

  it('allows calls up to the limit, then blocks', () => {
    const now = 1_000_000
    for (let i = 0; i < AGENT_RATE_LIMIT.MAX_CALLS; i++) {
      expect(allowAgentCall('user-1', now)).toBe(true)
    }
    // Next one in the same window is blocked
    expect(allowAgentCall('user-1', now)).toBe(false)
  })

  it('resets after the window passes', () => {
    const t0 = 1_000_000
    for (let i = 0; i < AGENT_RATE_LIMIT.MAX_CALLS; i++) allowAgentCall('user-1', t0)
    expect(allowAgentCall('user-1', t0)).toBe(false)

    // Advance past the window → allowed again
    const later = t0 + AGENT_RATE_LIMIT.WINDOW_MS + 1
    expect(allowAgentCall('user-1', later)).toBe(true)
  })

  it('tracks users independently', () => {
    const now = 1_000_000
    for (let i = 0; i < AGENT_RATE_LIMIT.MAX_CALLS; i++) allowAgentCall('user-1', now)
    expect(allowAgentCall('user-1', now)).toBe(false)
    // A different user is unaffected
    expect(allowAgentCall('user-2', now)).toBe(true)
  })
})
