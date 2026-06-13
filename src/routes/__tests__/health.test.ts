/**
 * Health and readiness probe route tests.
 *
 * GET /health — liveness, no DB required, always 200.
 * GET /ready  — readiness, queries DB and Redis; returns 503 when either fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

vi.mock('../../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
  },
}))

// Mock ioredis to avoid real network calls
vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue('PONG'),
      quit: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

import healthRoutes from '../health.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryRaw(impl = vi.fn().mockResolvedValue([{ '?column?': 1 }])) {
  return impl
}

async function buildApp(queryRawImpl = makeQueryRaw()): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(
    fp(async (a) => {
      a.decorate('prisma', { $queryRaw: queryRawImpl } as never)
    }),
  )
  await app.register(healthRoutes)
  return app
}

// ── GET /health ───────────────────────────────────────────────────────────────

describe('GET /health', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })

  it('returns status "ok"', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.status).toBe('ok')
  })

  it('includes version field', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('version')
    expect(typeof body.version).toBe('string')
  })

  it('includes startedAt as an ISO timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.startedAt).toBe('string')
    expect(() => new Date(body.startedAt as string)).not.toThrow()
  })

  it('includes uptime as a number', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.uptime).toBe('number')
  })

  it('does not query the database', async () => {
    const queryRaw = makeQueryRaw()
    app = await buildApp(queryRaw)
    await app.inject({ method: 'GET', url: '/health' })
    expect(queryRaw).not.toHaveBeenCalled()
  })
})

// ── GET /ready ────────────────────────────────────────────────────────────────

describe('GET /ready', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 when all dependencies are healthy', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(200)
  })

  it('includes database check with ok:true', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ready' })
    const body = JSON.parse(res.body) as { checks: Record<string, { ok: boolean }> }
    expect(body.checks['database']?.ok).toBe(true)
  })

  it('returns 503 when the database query fails', async () => {
    const failingQuery = vi.fn().mockRejectedValue(new Error('connection refused'))
    const app = await buildApp(failingQuery)
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(503)
  })

  it('returns status "degraded" when any check fails', async () => {
    const failingQuery = vi.fn().mockRejectedValue(new Error('timeout'))
    const app = await buildApp(failingQuery)
    const res = await app.inject({ method: 'GET', url: '/ready' })
    const body = JSON.parse(res.body) as { status: string }
    expect(body.status).toBe('degraded')
  })

  it('marks database check ok:false on DB failure', async () => {
    const failingQuery = vi.fn().mockRejectedValue(new Error('timeout'))
    const app = await buildApp(failingQuery)
    const res = await app.inject({ method: 'GET', url: '/ready' })
    const body = JSON.parse(res.body) as { checks: Record<string, { ok: boolean }> }
    expect(body.checks['database']?.ok).toBe(false)
  })

  it('includes latencyMs for each check', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ready' })
    const body = JSON.parse(res.body) as { checks: Record<string, { latencyMs: number }> }
    expect(typeof body.checks['database']?.latencyMs).toBe('number')
  })

  it('returns 503 when Redis is unreachable', async () => {
    const { Redis } = await import('ioredis')
    vi.mocked(Redis).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        ping: vi.fn(),
        quit: vi.fn(),
      }
    } as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(503)
  })

  it('marks redis check ok:false when Redis fails', async () => {
    const { Redis } = await import('ioredis')
    vi.mocked(Redis).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        ping: vi.fn(),
        quit: vi.fn(),
      }
    } as never)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/ready' })
    const body = JSON.parse(res.body) as { checks: Record<string, { ok: boolean }> }
    expect(body.checks['redis']?.ok).toBe(false)
  })
})
