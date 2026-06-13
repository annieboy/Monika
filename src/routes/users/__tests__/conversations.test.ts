/**
 * GET /users/me/conversations tests.
 *
 * Covers lines 234-268 of users/index.ts:
 *   - 200 with sessions when user exists
 *   - 404 when user not found
 *   - 410 when user.deletedAt is set
 *   - limit/offset from query params
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../../services/users/deletion.js', () => ({
  deleteUser: vi.fn().mockResolvedValue({ connectionsRevoked: 0, revokeErrors: [] }),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000002'

const MOCK_SESSIONS = [
  { sessionId: 'sess-1', messageCount: 3, firstAt: new Date('2024-03-01'), lastAt: new Date('2024-03-01') },
  { sessionId: 'sess-2', messageCount: 5, firstAt: new Date('2024-03-02'), lastAt: new Date('2024-03-02') },
]

function makeUser(overrides: Record<string, unknown> = {}) {
  return { id: USER_ID, deletedAt: null, ...overrides }
}

function makePrisma(
  user: ReturnType<typeof makeUser> | null = makeUser(),
  sessions: unknown[] = MOCK_SESSIONS,
  groupByCount: unknown[] = [{ sessionId: 'sess-1' }, { sessionId: 'sess-2' }],
): PrismaClient {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
    },
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue(sessions),
    conversation: {
      groupBy: vi.fn().mockResolvedValue(groupByCount),
    },
  } as unknown as PrismaClient
}

async function buildApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(userRoutes, { prefix: '/users' })
  return app
}

// ── GET /users/me/conversations ───────────────────────────────────────────────

describe('GET /users/me/conversations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with sessions when user exists', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: `/users/me/conversations?userId=${USER_ID}`,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { total: number; limit: number; sessions: unknown[] }
    expect(body.sessions).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('returns 404 when user not found', async () => {
    const app = await buildApp(makePrisma(null))
    const res = await app.inject({
      method: 'GET',
      url: `/users/me/conversations?userId=${USER_ID}`,
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { error: string }
    expect(body.error).toContain('not found')
  })

  it('returns 410 when user is deleted (deletedAt set)', async () => {
    const app = await buildApp(makePrisma(makeUser({ deletedAt: new Date() })))
    const res = await app.inject({
      method: 'GET',
      url: `/users/me/conversations?userId=${USER_ID}`,
    })
    expect(res.statusCode).toBe(410)
    const body = JSON.parse(res.body) as { error: string }
    expect(body.error).toContain('deleted')
  })

  it('applies limit from query param and returns it in response', async () => {
    const app = await buildApp(makePrisma(makeUser(), [MOCK_SESSIONS[0]], [{ sessionId: 'sess-1' }]))
    const res = await app.inject({
      method: 'GET',
      url: `/users/me/conversations?userId=${USER_ID}&limit=5&offset=0`,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { limit: number; offset: number }
    expect(body.limit).toBe(5)
    expect(body.offset).toBe(0)
  })

  it('applies offset from query param and returns it in response', async () => {
    const app = await buildApp(makePrisma(makeUser(), [], []))
    const res = await app.inject({
      method: 'GET',
      url: `/users/me/conversations?userId=${USER_ID}&limit=10&offset=20`,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { limit: number; offset: number }
    expect(body.offset).toBe(20)
    expect(body.limit).toBe(10)
  })

  it('returns 400 when userId is missing', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/users/me/conversations',
    })
    expect(res.statusCode).toBe(400)
  })
})
