/**
 * Per-user WhatsApp rate limiter backed by Redis.
 *
 * Uses INCR + EXPIRE to implement a fixed-window counter.
 * All WhatsApp traffic arrives from Meta's IPs so IP-level limiting is
 * useless — this keys on the phone hash instead.
 *
 * Fails open: if Redis is unavailable the request is allowed through so
 * a Redis outage doesn't cut off users from the product.
 */
import { Redis } from 'ioredis'

const WINDOW_SECS = 60
const MAX_REQUESTS = 10

let _redis: Redis | null = null

function getRedis(redisUrl: string): Redis {
  if (!_redis) {
    _redis = new Redis(redisUrl, {
      connectTimeout: 3000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
  }
  return _redis
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSecs: number
}

export async function checkUserRateLimit(
  phoneHash: string,
  redisUrl: string,
): Promise<RateLimitResult> {
  const redis = getRedis(redisUrl)
  const key = `rate:wa:${phoneHash}`

  try {
    const count = await redis.incr(key)
    if (count === 1) {
      // Set expiry only on first increment to avoid resetting the window
      await redis.expire(key, WINDOW_SECS)
    }
    if (count > MAX_REQUESTS) {
      const ttl = await redis.ttl(key)
      return { allowed: false, retryAfterSecs: Math.max(ttl, 1) }
    }
    return { allowed: true, retryAfterSecs: 0 }
  } catch {
    // Fail open — Redis down must not block users
    return { allowed: true, retryAfterSecs: 0 }
  }
}

/** Exported for testing only — resets the shared Redis singleton. */
export function _resetRedisForTest(): void {
  _redis = null
}
