/**
 * PrismaClient singleton.
 *
 * A single client is shared across the entire application.
 * Prisma manages a connection pool internally.
 */
import { PrismaClient } from '@prisma/client'
import { logger } from '../logger.js'

const log = logger.child({ service: 'prisma' })

export const prisma = new PrismaClient({
  log: [
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'warn' },
    ...(process.env['NODE_ENV'] === 'development'
      ? [{ emit: 'stdout' as const, level: 'query' as const }]
      : []),
  ],
  // Hard limit on how long a single query can run before being aborted.
  // Prevents slow queries from exhausting all connections / hanging requests.
  // 10s is generous for OLTP; complex analytics queries use separate timeouts.
  transactionOptions: {
    timeout: 10_000, // ms
  },
})

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect()
    log.info('Database connected')
  } catch (err) {
    log.error({ err }, 'Database connection failed')
    throw err
  }
}
