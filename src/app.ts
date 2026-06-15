/**
 * Fastify application factory.
 *
 * Returns a configured Fastify instance. Kept separate from index.ts so the
 * app can be imported in tests without starting the server (no side effects).
 *
 * Plugin registration order matters:
 *   1. Security (helmet, cors) — must wrap everything
 *   2. Rate limiting — applied globally, overridden per-route where needed
 *   3. Infrastructure (prisma) — available to all routes
 *   4. Routes — registered last
 */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'
import fp from 'fastify-plugin'
import { config } from './config.js'
import { logger } from './logger.js'
import prismaPlugin from './plugins/prisma.js'
import healthRoutes from './routes/health.js'
import whatsappRoutes from './routes/webhooks/whatsapp.js'
import truelayerRoutes from './routes/webhooks/truelayer.js'
import bankingRoutes from './routes/banking/index.js'
import agentRoutes from './routes/agent/index.js'
import adminRoutes from './routes/admin/index.js'
import devRoutes from './routes/dev/index.js'
import userRoutes from './routes/users/index.js'
import legalRoutes from './routes/legal/index.js'
import landingRoutes from './routes/landing/index.js'
import affiliateRoutes from './routes/affiliate.js'
import signupRoutes from './routes/signup/index.js'

export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    loggerInstance: logger,
    ignoreTrailingSlash: true,
    trustProxy: config.NODE_ENV === 'production',
  })

  // ── Security ───────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],   // Admin dashboard uses inline scripts
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  })

  await app.register(cors, {
    origin:
      config.NODE_ENV === 'production'
        ? ['https://app.monika.ai', 'https://monika-21wq.onrender.com']
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Global default: 100 requests / minute per IP.
  // Tighter limits are applied per route via config.rateLimit.
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // In production, use the real client IP (after trustProxy header resolution).
    // In test, key by a fixed string so tests don't hit limits.
    keyGenerator: (request) =>
      config.NODE_ENV === 'test'
        ? 'test-key'
        : (request.ip ?? 'unknown'),
    errorResponseBuilder: (_request, context) => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  })

  // ── Utilities ──────────────────────────────────────────────────────────────
  await app.register(sensible)

  // ── Infrastructure plugins ─────────────────────────────────────────────────
  await app.register(prismaPlugin)

  // ── Request ID propagation ─────────────────────────────────────────────────
  app.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-Id', request.id)
  })

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(healthRoutes)
  await app.register(whatsappRoutes, { prefix: '/webhooks' })
  await app.register(truelayerRoutes, { prefix: '/webhooks' })
  await app.register(bankingRoutes, { prefix: '/banking' })
  await app.register(agentRoutes, { prefix: '/agent' })
  await app.register(adminRoutes, { prefix: '/admin' })
  await app.register(userRoutes, { prefix: '/users' })
  await app.register(legalRoutes)
  await app.register(landingRoutes)
  await app.register(affiliateRoutes)
  await app.register(signupRoutes)

  if (config.NODE_ENV !== 'production') {
    await app.register(devRoutes, { prefix: '/dev' })
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
  app.setErrorHandler<Error>((err, request, reply) => {
    const fastifyErr = err as Error & { statusCode?: number }
    const statusCode = fastifyErr.statusCode ?? 500

    if (statusCode >= 500) {
      request.log.error({ err, statusCode }, 'Unhandled error')
    } else {
      request.log.warn({ err, statusCode }, 'Request error')
    }

    return reply.status(statusCode).send({
      error: err.name ?? 'Internal Server Error',
      message:
        config.NODE_ENV === 'production' && statusCode >= 500
          ? 'An internal error occurred'
          : err.message,
      requestId: request.id,
    })
  })

  return app
}

export { fp }
