import type { ConnectionOptions } from 'bullmq'
import { config } from '../config.js'

/**
 * Parses REDIS_URL into a BullMQ ConnectionOptions object.
 *
 * Passing a raw string as ConnectionOptions doesn't work reliably — BullMQ
 * (ioredis underneath) ignores the string and falls back to 127.0.0.1:6379.
 * Parsing the URL explicitly ensures the correct host/port are used.
 */
export function createRedisConnection(): ConnectionOptions {
  const url = new URL(config.REDIS_URL)
  const opts: ConnectionOptions = {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 6379,
  }
  if (url.username) (opts as Record<string, unknown>)['username'] = decodeURIComponent(url.username)
  if (url.password) (opts as Record<string, unknown>)['password'] = decodeURIComponent(url.password)
  if (url.pathname && url.pathname !== '/') {
    (opts as Record<string, unknown>)['db'] = parseInt(url.pathname.slice(1), 10) || 0
  }
  return opts
}
