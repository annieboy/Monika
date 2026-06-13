/**
 * Tests for POST /agent/chat route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../services/agent/classifier.js', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'spending_analysis', confidence: 0.95, method: 'rules' }),
}))
vi.mock('../../../services/agent/router.js', () => ({
  routeIntent: vi.fn().mockResolvedValue('You spent £200 on groceries.'),
}))
vi.mock('../../../lib/monitoring.js', () => ({
  captureException: vi.fn(),
}))
vi.mock('../../../config.js', () => ({
  config: { ANTHROPIC_API_KEY: 'test-key' },
}))
// Admin auth: mock it to always pass
vi.mock('../../admin/auth.js', () => ({
  requireAdminAuth: vi.fn().mockReturnValue(true),
}))

import Fastify from 'fastify'
import fp from 'fastify-plugin'
import agentRoutes from '../index.js'
import { classifyIntent } from '../../../services/agent/classifier.js'
import { routeIntent } from '../../../services/agent/router.js'
import { requireAdminAuth } from '../../admin/auth.js'

const VALID_UUID = '00000000-0000-4000-8000-000000000001'
const SESSION_UUID = '00000000-0000-4000-8000-000000000002'
const CONV_UUID = 'conv-uuid'

async function buildApp(prismaOverrides: Record<string, unknown> = {}) {
  const app = Fastify({ logger: false })
  await app.register(
    fp(async (a) => {
      a.decorate('prisma', {
        user: { findUnique: vi.fn().mockResolvedValue({ id: VALID_UUID }) },
        conversation: { create: vi.fn().mockResolvedValue({ id: CONV_UUID }) },
        ...prismaOverrides,
      } as never)
    }),
  )
  await app.register(agentRoutes)
  return app
}

describe('POST /chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-apply default mock implementations after clearAllMocks
    vi.mocked(classifyIntent).mockResolvedValue({ intent: 'spending_analysis', confidence: 0.95, method: 'rules' })
    vi.mocked(routeIntent).mockResolvedValue('You spent £200 on groceries.')
    vi.mocked(requireAdminAuth).mockReturnValue(true)
  })

  it('returns 200 with response on success', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.response).toBe('You spent £200 on groceries.')
    expect(body.userId).toBe(VALID_UUID)
  })

  it('returns 404 when user not found', async () => {
    const app = await buildApp({
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.error).toBe('User not found')
  })

  it('returns 500 when classifyIntent throws', async () => {
    vi.mocked(classifyIntent).mockRejectedValueOnce(new Error('classifier error'))
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.error).toBe('Internal server error')
  })

  it('returns 500 when routeIntent throws', async () => {
    vi.mocked(routeIntent).mockRejectedValueOnce(new Error('router error'))
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.error).toBe('Internal server error')
  })

  it('response includes intent, confidence, method', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.intent).toBe('spending_analysis')
    expect(body.confidence).toBe(0.95)
    expect(body.method).toBe('rules')
  })

  it('uses provided sessionId when given', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?', sessionId: SESSION_UUID },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.sessionId).toBe(SESSION_UUID)
  })

  it('generates sessionId when not provided', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.sessionId).toBe('string')
    // Should be a UUID format
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('creates conversation rows for both user and assistant', async () => {
    const conversationCreate = vi.fn().mockResolvedValue({ id: CONV_UUID })
    const app = await buildApp({
      conversation: { create: conversationCreate },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(200)
    expect(conversationCreate).toHaveBeenCalledTimes(2)
    // Verify one call is for 'user' role and one for 'assistant'
    const calls = conversationCreate.mock.calls as Array<[{ data: { role: string } }]>
    const roles = calls.map((c) => c[0].data.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('returns 401 when requireAdminAuth fails', async () => {
    // Simulate what the real requireAdminAuth does: send 401 and return false
    vi.mocked(requireAdminAuth).mockImplementationOnce((_req, reply) => {
      void reply.status(401).send('Unauthorized')
      return false
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { userId: VALID_UUID, message: 'How much did I spend?' },
    })
    expect(res.statusCode).toBe(401)
    expect(vi.mocked(classifyIntent)).not.toHaveBeenCalled()
  })
})
