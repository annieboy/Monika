/**
 * Fastify application factory.
 *
 * Returns a configured Fastify instance. Kept separate from index.ts so the
 * app can be imported in tests without starting the server (no side effects).
 *
 * Plugin registration order matters:
 *   1. Security (helmet, cors) — must wrap everything
 *   2. Infrastructure (prisma) — available to all routes
 *   3. Routes — registered last
 */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'
import fp from 'fastify-plugin'
import { config } from './config.js'
import { logger } from './logger.js'
import prismaPlugin from './plugins/prisma.js'
import healthRoutes from './routes/health.js'
import whatsappRoutes from './routes/webhooks/whatsapp.js'
import bankingRoutes from './routes/banking/index.js'
import agentRoutes from './routes/agent/index.js'
import adminRoutes from './routes/admin/index.js'
import devRoutes from './routes/dev/index.js'

export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    // Use our pre-configured Pino logger — Fastify will use this instance
    // for all internal logging (request start, close, errors).
    loggerInstance: logger,
    // Treat /foo and /foo/ as the same route — avoids 404 on missing trailing slash
    ignoreTrailingSlash: true,
    // Trust the X-Forwarded-For header from load balancers in production
    trustProxy: config.NODE_ENV === 'production',
  })

  // ── Security ───────────────────────────────────────────────────────────────
  await app.register(helmet, {
    // Disable contentSecurityPolicy for the API — we serve no HTML
    contentSecurityPolicy: false,
  })

  await app.register(cors, {
    origin:
      config.NODE_ENV === 'production'
        ? ['https://app.monika.ai']  // restrict in production
        : true,                      // allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })

  // ── Utilities ──────────────────────────────────────────────────────────────
  // @fastify/sensible adds httpErrors, assert, and other conveniences
  await app.register(sensible)

  // ── Infrastructure plugins ─────────────────────────────────────────────────
  await app.register(prismaPlugin)

  // ── Request ID middleware ──────────────────────────────────────────────────
  // Fastify generates a request ID per request by default (logged as reqId).
  // Expose it as a response header so clients can correlate logs.
  app.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-Id', request.id)
  })

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(healthRoutes)                          // /health, /ready
  await app.register(whatsappRoutes, { prefix: '/webhooks' }) // /webhooks/whatsapp
  await app.register(bankingRoutes, { prefix: '/banking' })   // /banking/connect, /banking/callback
  await app.register(agentRoutes, { prefix: '/agent' })       // /agent/chat
  await app.register(adminRoutes, { prefix: '/admin' })       // /admin — internal dashboard

  // Dev-only routes — never registered in production
  if (config.NODE_ENV !== 'production') {
    await app.register(devRoutes, { prefix: '/dev' })          // /dev/simulate, /dev/status
  }

  // ── 404 handler ────────────────────────────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    request.log.warn({ url: request.url, method: request.method }, 'Route not found')
    return reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    })
  })

  // ── Global error handler ───────────────────────────────────────────────────
  // Fastify passes FastifyError (which extends Error) to setErrorHandler.
  // We use the typed FastifyError to access statusCode safely.
  app.setErrorHandler<Error>((err, request, reply) => {
    const fastifyErr = err as Error & { statusCode?: number }
    const statusCode = fastifyErr.statusCode ?? 500

    // Log 5xx errors as errors, 4xx as warnings
    if (statusCode >= 500) {
      request.log.error({ err, statusCode }, 'Unhandled error')
    } else {
      request.log.warn({ err, statusCode }, 'Request error')
    }

    return reply.status(statusCode).send({
      error: err.name ?? 'Internal Server Error',
      message:
        config.NODE_ENV === 'production' && statusCode >= 500
          ? 'An internal error occurred' // never expose stack traces in production
          : err.message,
      requestId: request.id,
    })
  })

  return app
}

// fp re-export for when buildApp is used as a plugin in tests
export { fp }
