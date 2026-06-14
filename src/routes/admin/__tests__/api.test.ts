/**
 * Admin JSON API routes — unit tests.
 *
 * Tests cover:
 *   GET  /admin/api/offers              — pagination + active filter
 *   GET  /admin/api/offers/:id          — found / not found
 *   GET  /admin/api/ingestion-runs      — pagination
 *   GET  /admin/api/opportunities/stats — shape of response
 *   POST /admin/api/jobs/trigger        — valid job / unknown job
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerAdminApiRoutes } from '../api.js'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../queues/opportunityQueue.js', () => ({
  getOpportunityQueue: vi.fn().mockReturnValue({
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
  }),
  OPPORTUNITY_QUEUE: 'opportunity-engine',
}))

vi.mock('../../../queues/connection.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue({}),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2024-06-01T12:00:00Z')

const MOCK_OFFER = {
  id: 'offer-1',
  providerName: 'Acme Bank',
  providerSlug: 'acme-bank',
  title: 'Great Current Account',
  shortDescription: 'Switch and earn £150',
  affiliateNetwork: 'awin',
  commissionType: 'cpa',
  commissionValue: 50,
  isActive: true,
  requiresBankLink: false,
  isRegulated: true,
  startsAt: null,
  expiresAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  category: { name: 'Banking', slug: 'banking' },
}

const MOCK_RUN = {
  id: 'run-1',
  source: 'csv-import',
  status: 'completed',
  offersCreated: 5,
  offersUpdated: 2,
  offersExpired: 0,
  startedAt: NOW,
  completedAt: NOW,
  triggeredBy: null,
  errorMessage: null,
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    offer: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([MOCK_OFFER]),
      findUnique: vi.fn().mockResolvedValue(MOCK_OFFER),
      ...((overrides['offer'] as object) ?? {}),
    },
    offerIngestionRun: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([MOCK_RUN]),
      findFirst: vi.fn().mockResolvedValue(MOCK_RUN),
      ...((overrides['offerIngestionRun'] as object) ?? {}),
    },
    opportunity: {
      count: vi.fn().mockResolvedValue(0),
      ...((overrides['opportunity'] as object) ?? {}),
    },
    affiliateClick: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { commissionAmount: 250 }, _count: { _all: 5 } }),
      count: vi.fn().mockResolvedValue(3),
      ...((overrides['affiliateClick'] as object) ?? {}),
    },
    user: {
      count: vi.fn().mockResolvedValue(42),
      ...((overrides['user'] as object) ?? {}),
    },
    bankConnection: {
      count: vi.fn().mockResolvedValue(30),
      ...((overrides['bankConnection'] as object) ?? {}),
    },
    transaction: {
      count: vi.fn().mockResolvedValue(15000),
      ...((overrides['transaction'] as object) ?? {}),
    },
    conversation: {
      count: vi.fn().mockResolvedValue(200),
      ...((overrides['conversation'] as object) ?? {}),
    },
    savingsGoal: {
      count: vi.fn().mockResolvedValue(15),
      ...((overrides['savingsGoal'] as object) ?? {}),
    },
  }
}

async function buildApp(prismaOverrides: Record<string, unknown> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const prisma = makePrisma(prismaOverrides)
  app.decorate('prisma', prisma as unknown as import('@prisma/client').PrismaClient)
  await registerAdminApiRoutes(app)
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/offers', () => {
  it('returns paginated offer list', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/offers' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ total: number; offers: unknown[] }>()
    expect(body.total).toBe(1)
    expect(body.offers).toHaveLength(1)
    expect(body.offers[0]).toMatchObject({ id: 'offer-1', providerName: 'Acme Bank' })
  })

  it('passes active=false to query', async () => {
    const offerMock = { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([MOCK_OFFER, MOCK_OFFER]) }
    const app = await buildApp({ offer: offerMock })
    const res = await app.inject({ method: 'GET', url: '/api/offers?active=false' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ total: number }>()
    expect(body.total).toBe(2)
    // where should NOT include isActive filter
    expect(offerMock.count).toHaveBeenCalledWith({ where: {} })
  })

  it('respects pagination params', async () => {
    const offerMock = { count: vi.fn().mockResolvedValue(50), findMany: vi.fn().mockResolvedValue([]) }
    const app = await buildApp({ offer: offerMock })
    const res = await app.inject({ method: 'GET', url: '/api/offers?page=3&perPage=5' })
    expect(res.statusCode).toBe(200)
    expect(offerMock.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 5 }))
  })
})

describe('GET /api/offers/:id', () => {
  it('returns the offer when found', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/offers/offer-1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'offer-1' })
  })

  it('returns 404 when not found', async () => {
    const app = await buildApp({ offer: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn(), findMany: vi.fn() } })
    const res = await app.inject({ method: 'GET', url: '/api/offers/no-such-id' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/ingestion-runs', () => {
  it('returns paginated ingestion runs', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/ingestion-runs' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ total: number; runs: unknown[] }>()
    expect(body.total).toBe(1)
    expect(body.runs[0]).toMatchObject({ id: 'run-1', source: 'csv-import' })
  })
})

describe('GET /api/opportunities/stats', () => {
  it('returns stats with correct shape', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/opportunities/stats' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{
      allTime: { delivered: number; ctr: number; cvr: number }
      last7Days: { delivered: number }
      commissions: { approvedRevenue: number }
      lastIngestionRun: unknown
    }>()
    expect(body).toHaveProperty('allTime')
    expect(body).toHaveProperty('last7Days')
    expect(body).toHaveProperty('commissions')
    expect(body).toHaveProperty('lastIngestionRun')
    expect(typeof body.allTime.ctr).toBe('number')
  })
})

describe('POST /api/jobs/trigger', () => {
  it('enqueues a valid job and returns 202', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/trigger',
      payload: { job: 'detect-opportunities' },
    })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ ok: true, jobId: 'job-123', name: 'detect-opportunities' })
  })

  it('passes userId in job data when provided', async () => {
    const { getOpportunityQueue } = await import('../../../queues/opportunityQueue.js')
     
    const addMock = (getOpportunityQueue() as any).add as ReturnType<typeof vi.fn>
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/api/jobs/trigger',
      payload: { job: 'deliver-opportunities', userId: 'user-abc' },
    })
    expect(addMock).toHaveBeenCalledWith('deliver-opportunities', { userId: 'user-abc' }, { priority: 1 })
  })

  it('returns 400 for an unknown job name', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/trigger',
      payload: { job: 'nuke-database' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Unknown job') })
  })
})

describe('GET /api/metrics', () => {
  it('returns platform metrics with correct shape', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/metrics' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{
      timestamp: string
      users: { total: number; activeConnections: number; newLast7Days: number; newLast30Days: number }
      messages: { last7Days: number; last30Days: number }
      data: { totalTransactions: number; syncErrors: number; activeGoals: number }
    }>()
    expect(body.users.total).toBe(42)
    expect(body.users.activeConnections).toBe(30)
    expect(body.data.totalTransactions).toBe(15000)
    expect(body.data.activeGoals).toBe(15)
    expect(body.timestamp).toBeDefined()
  })
})
