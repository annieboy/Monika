import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'
import adminRoutes from '../index.js'

vi.mock('../../../services/offers/offerUpsertService.js', () => ({
  upsertOffer: vi.fn().mockResolvedValue({ action: 'created', id: 'offer-123' }),
  expireStaleOffers: vi.fn().mockResolvedValue(0),
}))

vi.mock('../pages/offers.js', () => ({
  offersListPage: vi.fn().mockResolvedValue('<html>offers list</html>'),
}))

// Mock all other admin page imports that admin/index.ts loads
vi.mock('../pages/dashboard.js', () => ({ dashboardPage: vi.fn().mockResolvedValue('<html>dash</html>') }))
vi.mock('../pages/users.js', () => ({
  usersListPage: vi.fn().mockResolvedValue('<html>users</html>'),
  userDetailPage: vi.fn().mockResolvedValue('<html>user</html>'),
}))
vi.mock('../pages/transactions.js', () => ({
  transactionsListPage: vi.fn().mockResolvedValue('<html>txns</html>'),
  transactionDetailPage: vi.fn().mockResolvedValue('<html>txn</html>'),
}))
vi.mock('../pages/audit.js', () => ({ auditLogPage: vi.fn().mockResolvedValue('<html>audit</html>') }))
vi.mock('../pages/analytics.js', () => ({ analyticsPage: vi.fn().mockResolvedValue('<html>analytics</html>') }))

const ADMIN_USER = 'testadmin'
const ADMIN_PASS = 'testpassword1'

function makePrisma(): PrismaClient {
  return {
    offer: {
      findUnique: vi.fn().mockResolvedValue({ id: 'offer-123' }),
      update: vi.fn().mockResolvedValue({}),
    },
    offerCategory: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient
}

async function buildTestApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(adminRoutes, { prefix: '/admin' })
  return app
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')
}

describe('GET /admin/offers', () => {
  let prisma: PrismaClient
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = makePrisma()
    app = await buildTestApp(prisma)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/offers' })
    expect(res.statusCode).toBe(401)
  })

  it('returns HTML page with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/offers',
      headers: { authorization: authHeader() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
  })
})

describe('POST /admin/offers', () => {
  let prisma: PrismaClient
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = makePrisma()
    app = await buildTestApp(prisma)
  })

  const validOffer = {
    providerName: 'Test Bank',
    providerSlug: 'test-bank',
    categorySlug: 'savings',
    title: 'Test Savings',
    shortDescription: '5% AER',
    affiliateNetwork: 'direct',
    affiliateProgramId: 'test-bank-uk',
    affiliateBaseUrl: 'https://test.bank/savings',
    commissionType: 'cpa',
    commissionValue: 20,
  }

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/offers',
      payload: validOffer,
    })
    expect(res.statusCode).toBe(401)
  })

  it('creates an offer and returns 201 with action=created', async () => {
    const { upsertOffer } = await import('../../../services/offers/offerUpsertService.js')
    vi.mocked(upsertOffer).mockResolvedValueOnce({ action: 'created', id: 'offer-new' })

    const res = await app.inject({
      method: 'POST',
      url: '/admin/offers',
      headers: { authorization: authHeader() },
      payload: validOffer,
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, action: 'created' })
  })

  it('updates an existing offer and returns 200 with action=updated', async () => {
    const { upsertOffer } = await import('../../../services/offers/offerUpsertService.js')
    vi.mocked(upsertOffer).mockResolvedValueOnce({ action: 'updated', id: 'offer-123' })

    const res = await app.inject({
      method: 'POST',
      url: '/admin/offers',
      headers: { authorization: authHeader() },
      payload: validOffer,
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, action: 'updated' })
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/offers',
      headers: { authorization: authHeader() },
      payload: { providerName: 'Incomplete' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for invalid affiliateNetwork value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/offers',
      headers: { authorization: authHeader() },
      payload: { ...validOffer, affiliateNetwork: 'unknown-network' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /admin/offers/:id', () => {
  let prisma: PrismaClient
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = makePrisma()
    app = await buildTestApp(prisma)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/admin/offers/offer-123' })
    expect(res.statusCode).toBe(401)
  })

  it('soft-expires an offer and returns 200', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/offers/offer-123',
      headers: { authorization: authHeader() },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'offer-123' },
      data: expect.objectContaining({ isActive: false }),
    })
  })

  it('returns 404 when offer does not exist', async () => {
    vi.mocked(prisma.offer.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/offers/nonexistent',
      headers: { authorization: authHeader() },
    })

    expect(res.statusCode).toBe(404)
  })
})
