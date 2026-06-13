/**
 * DELETE /banking/connections/:connectionId tests.
 *
 * Covers: 404 (not found / wrong user), 409 (already revoked),
 * 204 success, TrueLayer revocation attempt, audit log written,
 * best-effort revocation (API failure still marks DB revoked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../banking/providers/truelayer.js', () => ({
  TrueLayerProvider: vi.fn().mockImplementation(function () {
    return { revokeConsent: vi.fn().mockResolvedValue(undefined) }
  }),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('access-token')),
}))

vi.mock('../../../services/onboarding/audit.js', () => ({
  logConsentEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../config.js', () => ({
  config: {
    TRUELAYER_CLIENT_ID: 'tl-client',
    TRUELAYER_CLIENT_SECRET: 'tl-secret',
    TRUELAYER_REDIRECT_URI: 'https://example.com/callback',
    TRUELAYER_ENVIRONMENT: 'sandbox',
    ENCRYPTION_KEY: 'a'.repeat(64),
  },
}))

import disconnectRoute from '../disconnect.js'
import { logConsentEvent } from '../../../services/onboarding/audit.js'
import { TrueLayerProvider } from '../../../banking/providers/truelayer.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONN_ID = '00000000-0000-0000-0000-000000000099'
const USER_ID = '00000000-0000-0000-0000-000000000001'

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID,
    provider: 'truelayer' as const,
    accessTokenEnc: Buffer.from('encrypted'),
    consentStatus: 'active',
    ...overrides,
  }
}

function makePrisma(connection: ReturnType<typeof makeConnection> | null = makeConnection()): PrismaClient {
  return {
    bankConnection: {
      findFirst: vi.fn().mockResolvedValue(connection),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

async function buildApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(disconnectRoute, { prefix: '/banking' })
  return app
}

function deleteReq(connId = CONN_ID) {
  return {
    method: 'DELETE' as const,
    url: `/banking/connections/${connId}`,
    payload: { userId: USER_ID },
    headers: { 'content-type': 'application/json' },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DELETE /banking/connections/:connectionId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when the connection does not exist', async () => {
    const app = await buildApp(makePrisma(null))
    const res = await app.inject(deleteReq())
    expect(res.statusCode).toBe(404)
  })

  it('returns 409 when the connection is already revoked', async () => {
    const app = await buildApp(makePrisma(makeConnection({ consentStatus: 'revoked' })))
    const res = await app.inject(deleteReq())
    expect(res.statusCode).toBe(409)
  })

  it('returns 204 on successful revocation', async () => {
    const app = await buildApp(makePrisma())
    const res = await app.inject(deleteReq())
    expect(res.statusCode).toBe(204)
  })

  it('updates consentStatus to "revoked" in the DB', async () => {
    const prisma = makePrisma()
    const app = await buildApp(prisma)
    await app.inject(deleteReq())
    expect(prisma.bankConnection.update).toHaveBeenCalledOnce()
    const arg = vi.mocked(prisma.bankConnection.update).mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(arg.data.consentStatus).toBe('revoked')
  })

  it('writes an audit log entry for bank_disconnected', async () => {
    const app = await buildApp(makePrisma())
    await app.inject(deleteReq())
    expect(logConsentEvent).toHaveBeenCalledOnce()
    const [, event, userId] = vi.mocked(logConsentEvent).mock.calls[0]!
    expect(event).toBe('bank_disconnected')
    expect(userId).toBe(USER_ID)
  })

  it('calls TrueLayer revokeConsent for truelayer connections', async () => {
    const app = await buildApp(makePrisma(makeConnection({ provider: 'truelayer' })))
    await app.inject(deleteReq())
    const instance = vi.mocked(TrueLayerProvider).mock.results[0]!.value as {
      revokeConsent: ReturnType<typeof vi.fn>
    }
    expect(instance.revokeConsent).toHaveBeenCalledOnce()
  })

  it('still marks revoked in DB even if TrueLayer API fails (best-effort)', async () => {
    vi.mocked(TrueLayerProvider).mockImplementationOnce(function () {
      return { revokeConsent: vi.fn().mockRejectedValue(new Error('API timeout')) }
    })
    const prisma = makePrisma()
    const app = await buildApp(prisma)
    const res = await app.inject(deleteReq())
    expect(res.statusCode).toBe(204)
    expect(prisma.bankConnection.update).toHaveBeenCalledOnce()
  })

  it('skips TrueLayer API call for mock connections', async () => {
    const app = await buildApp(makePrisma(makeConnection({ provider: 'mock' })))
    await app.inject(deleteReq())
    expect(TrueLayerProvider).not.toHaveBeenCalled()
  })
})
