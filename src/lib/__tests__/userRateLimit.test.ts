import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ioredis before importing the module under test
const mockIncr = vi.fn()
const mockExpire = vi.fn()
const mockTtl = vi.fn()

vi.mock('ioredis', () => {
  class MockRedis {
    incr = mockIncr
    expire = mockExpire
    ttl = mockTtl
  }
  return { Redis: MockRedis }
})

import { _resetRedisForTest, checkUserRateLimit } from '../userRateLimit.js'

const PHONE_HASH = 'abc123deadbeef'
const REDIS_URL = 'redis://localhost:6379'

describe('checkUserRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetRedisForTest()
  })

  it('allows first request and sets expiry', async () => {
    mockIncr.mockResolvedValueOnce(1)
    mockExpire.mockResolvedValueOnce(1)

    const result = await checkUserRateLimit(PHONE_HASH, REDIS_URL)

    expect(result.allowed).toBe(true)
    expect(result.retryAfterSecs).toBe(0)
    expect(mockIncr).toHaveBeenCalledWith(`rate:wa:${PHONE_HASH}`)
    expect(mockExpire).toHaveBeenCalledWith(`rate:wa:${PHONE_HASH}`, 60)
  })

  it('allows requests within the limit', async () => {
    mockIncr.mockResolvedValueOnce(5)

    const result = await checkUserRateLimit(PHONE_HASH, REDIS_URL)

    expect(result.allowed).toBe(true)
    // No expire call when count > 1
    expect(mockExpire).not.toHaveBeenCalled()
  })

  it('allows exactly at the limit (count === 10)', async () => {
    mockIncr.mockResolvedValueOnce(10)

    const result = await checkUserRateLimit(PHONE_HASH, REDIS_URL)

    expect(result.allowed).toBe(true)
  })

  it('blocks when count exceeds limit', async () => {
    mockIncr.mockResolvedValueOnce(11)
    mockTtl.mockResolvedValueOnce(45)

    const result = await checkUserRateLimit(PHONE_HASH, REDIS_URL)

    expect(result.allowed).toBe(false)
    expect(result.retryAfterSecs).toBe(45)
  })

  it('returns retryAfterSecs >= 1 even when TTL is 0 or negative', async () => {
    mockIncr.mockResolvedValueOnce(99)
    mockTtl.mockResolvedValueOnce(0)

    const result = await checkUserRateLimit(PHONE_HASH, REDIS_URL)

    expect(result.allowed).toBe(false)
    expect(result.retryAfterSecs).toBe(1)
  })

  it('fails open when Redis throws', async () => {
    mockIncr.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await checkUserRateLimit(PHONE_HASH, REDIS_URL)

    expect(result.allowed).toBe(true)
    expect(result.retryAfterSecs).toBe(0)
  })
})
