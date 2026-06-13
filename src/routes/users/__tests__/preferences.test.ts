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

const DEFAULT_PREFS = {
  opportunitiesConsent: false,
  maxMessagesPerWeek: 2,
  maxMessagesPerMonth: 6,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  disabledCategories: [],
  consentGivenAt: null,
  consentWithdrawnAt: null,
}

function makePrisma(prefs: object | null = DEFAULT_PREFS): PrismaClient {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', deletedAt: null }),
    },
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(prefs),
      upsert: vi.fn().mockImplementation(({ create }: { create: object }) =>
        Promise.resolve({ ...DEFAULT_PREFS, ...create }),
      ),
    },
  } as unknown as PrismaClient
}

async function buildTestApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(userRoutes, { prefix: '/users' })
  return app
}

const VALID_USER = '00000000-0000-0000-0000-000000000001'

describe('GET /users/me/preferences', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildTestApp(makePrisma())
  })

  it('returns default preferences when no record exists', async () => {
    const prisma = makePrisma(null)
    const testApp = await buildTestApp(prisma)
    const res = await testApp.inject({ method: 'GET', url: `/users/me/preferences?userId=${VALID_USER}` })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as typeof DEFAULT_PREFS
    expect(body.opportunitiesConsent).toBe(false)
    expect(body.maxMessagesPerWeek).toBe(2)
    expect(body.quietHoursStart).toBe('21:00')
  })

  it('returns stored preferences', async () => {
    const res = await app.inject({ method: 'GET', url: `/users/me/preferences?userId=${VALID_USER}` })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as typeof DEFAULT_PREFS
    expect(body.quietHoursStart).toBe('21:00')
  })

  it('returns 404 when user not found', async () => {
    const prisma = makePrisma()
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null)
    const testApp = await buildTestApp(prisma)
    const res = await testApp.inject({ method: 'GET', url: `/users/me/preferences?userId=${VALID_USER}` })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when userId missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me/preferences' })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /users/me/preferences', () => {
  let app: FastifyInstance
  let prisma: PrismaClient

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = makePrisma()
    app = await buildTestApp(prisma)
  })

  it('updates quiet hours', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/me/preferences?userId=${VALID_USER}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
    })

    expect(res.statusCode).toBe(200)
    expect(prisma.userOpportunityPreferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
      }),
    )
  })

  it('sets consentGivenAt when enabling consent for first time', async () => {
    // Current prefs: consent = false
    vi.mocked(prisma.userOpportunityPreferences.findUnique).mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      opportunitiesConsent: false,
    } as never)

    await app.inject({
      method: 'PATCH',
      url: `/users/me/preferences?userId=${VALID_USER}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opportunitiesConsent: true }),
    })

    expect(prisma.userOpportunityPreferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          opportunitiesConsent: true,
          consentGivenAt: expect.any(Date),
          consentMethod: 'api',
        }),
      }),
    )
  })

  it('sets consentWithdrawnAt when revoking consent', async () => {
    vi.mocked(prisma.userOpportunityPreferences.findUnique).mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      opportunitiesConsent: true,
    } as never)

    await app.inject({
      method: 'PATCH',
      url: `/users/me/preferences?userId=${VALID_USER}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opportunitiesConsent: false }),
    })

    expect(prisma.userOpportunityPreferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          consentWithdrawnAt: expect.any(Date),
        }),
      }),
    )
  })

  it('updates disabledCategories', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/users/me/preferences?userId=${VALID_USER}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabledCategories: ['energy', 'broadband'] }),
    })

    expect(prisma.userOpportunityPreferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ disabledCategories: ['energy', 'broadband'] }),
      }),
    )
  })

  it('returns 400 for invalid quietHoursStart pattern', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/me/preferences?userId=${VALID_USER}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quietHoursStart: 'not-a-time' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when user not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null)
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/me/preferences?userId=${VALID_USER}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxMessagesPerWeek: 3 }),
    })
    expect(res.statusCode).toBe(404)
  })
})
