/**
 * GDPR self-service route tests.
 *
 * POST /users/delete  — Right to Erasure (Article 17)
 *   404 when user not found, 409 when already deleted, 200 with counts on success.
 *
 * GET  /users/export  — Right of Access (Article 15)
 *   404 when user not found, 410 when user data deleted, 200 with attachment header.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../../services/users/deletion.js', () => ({
  deleteUser: vi.fn().mockResolvedValue({ connectionsRevoked: 2, revokeErrors: [] }),
  exportUserData: vi.fn().mockResolvedValue({
    exportedAt: new Date().toISOString(),
    profile: {},
    bankConnections: [],
    transactions: [],
    conversationHistory: [],
    consentHistory: [],
  }),
}))

import userRoutes from '../index.js'
import { deleteUser } from '../../../services/users/deletion.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001'

function makeUser(overrides: Record<string, unknown> = {}) {
  return { id: USER_ID, deletedAt: null, ...overrides }
}

function makePrisma(user: ReturnType<typeof makeUser> | null = makeUser()): PrismaClient {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
    },
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

async function buildApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(userRoutes, { prefix: '/users' })
  return app
}

// ── POST /users/delete ────────────────────────────────────────────────────────

describe('POST /users/delete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when the user does not exist', async () => {
    const app = await buildApp(makePrisma(null))
    const res = await app.inject({
      method: 'POST',
      url: '/users/delete',
      payload: { userId: USER_ID },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 409 when the user is already deleted', async () => {
    const app = await buildApp(makePrisma(makeUser({ deletedAt: new Date() })))
    const res = await app.inject({
      method: 'POST',
      url: '/users/delete',
      payload: { userId: USER_ID },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('returns 200 on successful deletion', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({
      method: 'POST',
      url: '/users/delete',
      payload: { userId: USER_ID },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns connectionsRevoked count in the response body', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({
      method: 'POST',
      url: '/users/delete',
      payload: { userId: USER_ID },
      headers: { 'content-type': 'application/json' },
    })
    const body = JSON.parse(res.body) as { connectionsRevoked: number; message: string }
    expect(body.connectionsRevoked).toBe(2)
    expect(typeof body.message).toBe('string')
  })

  it('calls deleteUser with the correct userId', async () => {
    const app = await buildApp(makePrisma())
    await app.inject({
      method: 'POST',
      url: '/users/delete',
      payload: { userId: USER_ID },
      headers: { 'content-type': 'application/json' },
    })
    expect(deleteUser).toHaveBeenCalledWith(expect.anything(), USER_ID)
  })

  it('does not call deleteUser when the user is not found', async () => {
    const app = await buildApp(makePrisma(null))
    await app.inject({
      method: 'POST',
      url: '/users/delete',
      payload: { userId: USER_ID },
      headers: { 'content-type': 'application/json' },
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('returns 400 when userId is missing from the body', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({
      method: 'POST',
      url: '/users/delete',
      payload: {},
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── GET /users/export ─────────────────────────────────────────────────────────

describe('GET /users/export', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when the user does not exist', async () => {
    const app = await buildApp(makePrisma(null))
    const res = await app.inject({ method: 'GET', url: `/users/export?userId=${USER_ID}` })
    expect(res.statusCode).toBe(404)
  })

  it('returns 410 when the user data has been deleted', async () => {
    const app = await buildApp(makePrisma(makeUser({ deletedAt: new Date() })))
    const res = await app.inject({ method: 'GET', url: `/users/export?userId=${USER_ID}` })
    expect(res.statusCode).toBe(410)
  })

  it('returns 200 on success', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: `/users/export?userId=${USER_ID}` })
    expect(res.statusCode).toBe(200)
  })

  it('returns JSON with exportedAt in the body', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: `/users/export?userId=${USER_ID}` })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('exportedAt')
  })

  it('sets Content-Disposition attachment header', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: `/users/export?userId=${USER_ID}` })
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('.json')
  })

  it('returns 400 when userId is missing from query string', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: '/users/export' })
    expect(res.statusCode).toBe(400)
  })
})
