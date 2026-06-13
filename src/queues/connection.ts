import type { ConnectionOptions } from 'bullmq'
import { config } from '../config.js'

// BullMQ accepts a Redis URL string directly as ConnectionOptions.
// Using a string avoids type conflicts between the project's ioredis version
// and BullMQ's bundled ioredis version.
export function createRedisConnection(): ConnectionOptions {
  return config.REDIS_URL as ConnectionOptions
}
