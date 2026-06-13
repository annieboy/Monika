/**
 * Health check routes.
 *
 * GET /health — lightweight liveness check (no DB). Used by load balancers.
 *               Returns 200 immediately; never queries external services.
 *
 * GET /ready  — readiness check. Verifies the database is reachable.
 *               Used by ECS/Kubernetes to decide whether to send traffic here.
 *               Returns 503 if any dependency is unavailable.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'

// Read version once at startup — avoids repeated filesystem I/O
function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { version: string }
    return pkg.version
  } catch {
    return 'unknown'
  }
}

const VERSION = getVersion()
const STARTED_AT = new Date().toISOString()

const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /health
   * Liveness probe — is this process alive?
   * Must not query the database. Must respond in < 10ms.
   */
  app.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            startedAt: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      status: 'ok',
      version: VERSION,
      startedAt: STARTED_AT,
      uptime: Math.floor(process.uptime()),
    })
  })

  /**
   * GET /ready
   * Readiness probe — are all dependencies available?
   * Queries the database with a lightweight SELECT 1.
   * Returns 503 if any check fails so the load balancer stops sending traffic.
   */
  app.get('/ready', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  latencyMs: { type: 'number' },
                  error: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  latencyMs: { type: 'number' },
                  error: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

    // Database check
    const dbStart = Date.now()
    try {
      await request.server.prisma.$queryRaw`SELECT 1`
      checks['database'] = { ok: true, latencyMs: Date.now() - dbStart }
    } catch (err) {
      checks['database'] = {
        ok: false,
        latencyMs: Date.now() - dbStart,
        // Never leak DB connection details in production
        error: process.env['NODE_ENV'] === 'production' ? 'Database unavailable' : (err instanceof Error ? err.message : 'Unknown error'),
      }
    }

    // Redis check
    const redisStart = Date.now()
    try {
      const { Redis } = await import('ioredis')
      const redis = new Redis(config.REDIS_URL, { connectTimeout: 3000, enableOfflineQueue: false, lazyConnect: true })
      await redis.connect()
      await redis.ping()
      await redis.quit()
      checks['redis'] = { ok: true, latencyMs: Date.now() - redisStart }
    } catch (err) {
      checks['redis'] = {
        ok: false,
        latencyMs: Date.now() - redisStart,
        error: process.env['NODE_ENV'] === 'production' ? 'Redis unavailable' : (err instanceof Error ? err.message : 'Unknown error'),
      }
    }

    const allOk = Object.values(checks).every((c) => c.ok)
    const status = allOk ? 200 : 503

    return reply.status(status).send({
      status: allOk ? 'ok' : 'degraded',
      checks,
    })
  })
}

export default healthRoutes
