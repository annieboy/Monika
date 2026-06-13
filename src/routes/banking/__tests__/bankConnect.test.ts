/**
 * Tests for the bank connection post-connect side-effects:
 *   - consent opt-in is recorded
 *   - detect-opportunities job is enqueued
 *
 * These are the changes that close the E2E opportunity delivery gap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'

// ── Mocks (all factories must be inline — vi.mock is hoisted) ────────────────

vi.mock('../../../queues/opportunityQueue.js', () => ({
  getOpportunityQueue: vi.fn().mockReturnValue({ add: vi.fn().mockResolvedValue({ id: 'job-1' }) }),
}))

vi.mock('../../../services/compliance/consentService.js', () => ({
  recordOptIn: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../services/whatsapp/notify.js', () => ({
  sendBankConnectedNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../banking/connection.js', () => ({
  createMockConnection: vi.fn().mockResolvedValue({
    connection: { id: 'conn-1', provider: 'mock' },
    syncResult: { accountsSynced: 2, transactionsImported: 45, transactionsSkipped: 0 },
  }),
  createTrueLayerConnection: vi.fn().mockResolvedValue({
    connection: { id: 'conn-1', provider: 'truelayer' },
    syncResult: { accountsSynced: 2, transactionsImported: 45, transactionsSkipped: 0 },
  }),
  resolveProvider: vi.fn().mockReturnValue({
    exchangeCode: vi.fn().mockResolvedValue({
      providerConsentId: 'consent-123',
      accessToken: 'tok',
      scopes: ['accounts', 'transactions'],
    }),
  }),
}))

vi.mock('../../../banking/oauth-state.js', () => ({
  decodeOAuthState: vi.fn().mockReturnValue('00000000-0000-0000-0000-000000000001'),
}))

vi.mock('../../../services/onboarding/audit.js', () => ({
  logConsentEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../services/onboarding/pages.js', () => ({
  successPage: vi.fn().mockReturnValue('<html>success</html>'),
  failurePage: vi.fn().mockReturnValue('<html>failure</html>'),
}))

// Import after mocks so vi.mocked() resolves correctly
import bankingRoutes from '../index.js'
import { recordOptIn } from '../../../services/compliance/consentService.js'
import { getOpportunityQueue } from '../../../queues/opportunityQueue.js'
import { decodeOAuthState } from '../../../banking/oauth-state.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma(): PrismaClient {
  return {
    user: { findUnique: vi.fn() },
    bankConnection: { updateMany: vi.fn() },
  } as unknown as PrismaClient
}

async function buildTestApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(bankingRoutes, { prefix: '/banking' })
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /banking/connect?mock=true — post-connect side-effects', () => {
  let app: FastifyInstance
  let mockAdd: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
    vi.mocked(getOpportunityQueue).mockReturnValue({ add: mockAdd } as never)
    app = await buildTestApp(makePrisma())
  })

  it('returns connection details on success', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/banking/connect?mock=true&userId=00000000-0000-0000-0000-000000000001',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.connectionId).toBe('conn-1')
    expect(body.accountsSynced).toBe(2)
    expect(body.transactionsImported).toBe(45)
  })

  it('records opt-in consent after mock bank connect', async () => {
    await app.inject({
      method: 'GET',
      url: '/banking/connect?mock=true&userId=00000000-0000-0000-0000-000000000001',
    })
    expect(recordOptIn).toHaveBeenCalledWith(
      expect.anything(),
      '00000000-0000-0000-0000-000000000001',
      'bank_connect_mock',
    )
  })

  it('enqueues detect-opportunities job after mock bank connect', async () => {
    await app.inject({
      method: 'GET',
      url: '/banking/connect?mock=true&userId=00000000-0000-0000-0000-000000000001',
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(mockAdd).toHaveBeenCalledWith(
      'detect-opportunities',
      { userId: '00000000-0000-0000-0000-000000000001' },
      expect.objectContaining({ priority: 1 }),
    )
  })

  it('returns 400 when userId is missing for mock', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/banking/connect?mock=true',
    })
    expect(res.statusCode).toBe(400)
    expect(recordOptIn).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})

describe('GET /banking/callback — post-connect side-effects', () => {
  let app: FastifyInstance
  let mockAdd: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
    vi.mocked(getOpportunityQueue).mockReturnValue({ add: mockAdd } as never)
    vi.mocked(decodeOAuthState).mockReturnValue('00000000-0000-0000-0000-000000000001')
    app = await buildTestApp(makePrisma())
  })

  it('records opt-in consent after successful OAuth callback', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/banking/callback?code=auth-code-123&state=signed-state-abc',
    })
    expect(res.statusCode).toBe(200)
    expect(recordOptIn).toHaveBeenCalledWith(
      expect.anything(),
      '00000000-0000-0000-0000-000000000001',
      'bank_connect',
    )
  })

  it('enqueues detect-opportunities job after successful OAuth callback', async () => {
    await app.inject({
      method: 'GET',
      url: '/banking/callback?code=auth-code-123&state=signed-state-abc',
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(mockAdd).toHaveBeenCalledWith(
      'detect-opportunities',
      { userId: '00000000-0000-0000-0000-000000000001' },
      expect.objectContaining({ priority: 1 }),
    )
  })

  it('does NOT record opt-in when OAuth state is invalid', async () => {
    vi.mocked(decodeOAuthState).mockReturnValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/banking/callback?code=auth-code-123&state=bad-state',
    })
    expect(res.statusCode).toBe(400)
    expect(recordOptIn).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
