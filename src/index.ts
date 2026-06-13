/**
 * Server entry point.
 *
 * Loads .env first (dotenv), then imports config (which validates env vars
 * and exits on failure), builds the Fastify app, and starts listening.
 * Handles graceful shutdown on SIGTERM and SIGINT.
 */
import { config } from './config.js'
import { logger } from './logger.js'
import { buildApp } from './app.js'
import { initMonitoring, flushMonitoring, captureException } from './lib/monitoring.js'
import { startSyncScheduler } from './services/sync/scheduler.js'
import { startOpportunityWorker } from './workers/opportunityWorker.js'
import { scheduleRecurringJobs } from './queues/opportunityQueue.js'

async function start(): Promise<void> {
  await initMonitoring()

  const app = await buildApp()

  // Graceful shutdown — give in-flight requests up to 30s to complete
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received — closing server')

    // Hard timeout: if shutdown takes >30s, force exit
    const hardTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 30s — forcing exit')
      process.exit(1)
    }, 30_000)
    hardTimeout.unref()

    try {
      await app.close()
      await flushMonitoring(2000)
      logger.info('Server closed cleanly')
      process.exit(0)
    } catch (err) {
      captureException(err)
      logger.error({ err }, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  // Unhandled promise rejections should never silently swallow errors
  process.on('unhandledRejection', (reason) => {
    captureException(reason)
    logger.error({ reason }, 'Unhandled promise rejection — this is a bug')
    process.exit(1)
  })

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' })
    logger.info(
      {
        port: config.PORT,
        env: config.NODE_ENV,
        truelayerEnv: config.TRUELAYER_ENVIRONMENT,
      },
      'Server started',
    )
    if (config.NODE_ENV === 'production') {
      startSyncScheduler(app.prisma)
      startOpportunityWorker(app.prisma)
      await scheduleRecurringJobs()
    }
  } catch (err) {
    logger.error({ err }, 'Failed to start server')
    process.exit(1)
  }
}

void start()
