/**
 * PrismaClient singleton.
 *
 * A single client is shared across the entire application.
 * Prisma manages a connection pool internally.
 *
 * Note: Prisma 6 removed the $on('error') / $on('warn') event API.
 * Query logging is configured via the `log` option instead.
 */
import { PrismaClient } from '@prisma/client'
import { logger } from '../logger.js'

const log = logger.child({ service: 'prisma' })

export const prisma = new PrismaClient({
  log: [
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'warn' },
    // Enable query logging only in development to avoid log noise
    ...(process.env['NODE_ENV'] === 'development'
      ? [{ emit: 'stdout' as const, level: 'query' as const }]
      : []),
  ],
})

// Verify the connection is usable at startup
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect()
    log.info('Database connected')
  } catch (err) {
    log.error({ err }, 'Database connection failed')
    throw err
  }
}
