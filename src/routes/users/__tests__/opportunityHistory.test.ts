import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'
import userRoutes from '../index.js'

vi.mock('../../../services/users/deletion.js', () => ({
  deleteUser: vi.fn().mockResolvedValue({ connectionsRevoked: 0 }),
  exportUserData: vi.fn().mockResolvedValue({ user: {}, opportunities: [] }),
}))

const MOCK_OPPORTUNITIES = [
  {
    id: 'opp-1',
    status: 'DELIVERED',
    annualSavingEstimate: { valueOf: () => 240, toString: () => '240' },
    savingConfidence: 0.85,
    createdAt: new Date('2024-01-01'),
    deliveredAt: new Date('2024-01-02'),
    expiresAt: null,
    offer: {
      id: 'offer-1',
      title: 'Switch & Save',
      providerName: 'Acme',
      shortDescription: 'A great deal',
      category: { slug: 'savings', name: 'Savings' },
    },
  },
]

function makePrisma(overrides: Partial<Record<string, unknown>> = {}): PrismaClient {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', deletedAt: null }),
    },
    opportunity: {
      findMany: vi.fn().mockResolvedValue(MOCK_OPPORTUNITIES),
      count: vi.fn().mockResolvedValue(1),
    },
    ...overrides,
  } as unknown as PrismaClient
}

async function buildTestApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(userRoutes, { prefix: '/users' })
  return app
}

describe('GET /users/me/opportunities', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildTestApp(makePrisma())
  })

  it('returns opportunity list for valid user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/me/opportunities?userId=00000000-0000-0000-0000-000000000001',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { total: number; items: unknown[] }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
  })

  it('returns 400 when userId missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me/opportunities' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when user not found', async () => {
    const prisma = makePrisma()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null)
    const testApp = await buildTestApp(prisma)
    const res = await testApp.inject({
      method: 'GET',
      url: '/users/me/opportunities?userId=00000000-0000-0000-0000-000000000001',
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 410 when user is deleted', async () => {
    const prisma = makePrisma()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'user-1', deletedAt: new Date() } as never)
    const testApp = await buildTestApp(prisma)
    const res = await testApp.inject({
      method: 'GET',
      url: '/users/me/opportunities?userId=00000000-0000-0000-0000-000000000001',
    })
    expect(res.statusCode).toBe(410)
  })

  it('respects limit and offset query params', async () => {
    const prisma = makePrisma()
    const testApp = await buildTestApp(prisma)
    await testApp.inject({
      method: 'GET',
      url: '/users/me/opportunities?userId=00000000-0000-0000-0000-000000000001&limit=5&offset=10',
    })
    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    )
  })

  it('caps limit at 100', async () => {
    const prisma = makePrisma()
    const testApp = await buildTestApp(prisma)
    await testApp.inject({
      method: 'GET',
      url: '/users/me/opportunities?userId=00000000-0000-0000-0000-000000000001&limit=999',
    })
    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })

  it('converts Decimal annualSavingEstimate to number', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/me/opportunities?userId=00000000-0000-0000-0000-000000000001',
    })
    const body = JSON.parse(res.body) as { items: { annualSavingEstimate: number }[] }
    expect(typeof body.items[0]?.annualSavingEstimate).toBe('number')
    expect(body.items[0]?.annualSavingEstimate).toBe(240)
  })
})
