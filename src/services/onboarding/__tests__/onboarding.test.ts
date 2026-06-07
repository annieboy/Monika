import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'
import { generateOnboardingToken, validateAndConsumeToken } from '../token.js'
import { logConsentEvent } from '../audit.js'
import bankingRoutes from '../../../routes/banking/index.js'

// ── Mock Prisma builders ───────────────────────────────────────────────────

function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    token: 'a'.repeat(64),
    userId: 'user-uuid',
    purpose: 'bank_connect',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeMockConnectionResult() {
  return {
    connection: {
      id: 'conn-uuid',
      provider: 'mock',
      providerConsentId: 'mock-consent-id',
      bankId: 'mock-bank',
      bankDisplayName: 'Mock Bank (Sandbox)',
      userId: 'user-uuid',
      accessTokenEnc: Buffer.from('enc'),
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      consentStatus: 'active',
      consentScopes: ['accounts', 'transactions'],
      lastSyncAt: new Date(),
      lastSyncStatus: 'success',
      lastSyncError: null,
      syncCursor: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      bankLogoUrl: null,
    },
    syncResult: { accountsSynced: 2, transactionsImported: 250, transactionsSkipped: 0, errors: [] },
  }
}

function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    onboardingToken: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(makeToken()),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    bankConnection: {
      upsert: vi.fn().mockResolvedValue(makeMockConnectionResult().connection),
      update: vi.fn().mockResolvedValue({}),
    },
    account: {
      upsert: vi.fn().mockResolvedValue({ id: 'acct-uuid', providerAccountId: 'mock-account-current' }),
    },
    transaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'txn-uuid' }),
    },
    user: {
      update: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as PrismaClient
}

function makePrismaPlugin(prisma: PrismaClient) {
  return fp(async (app: FastifyInstance) => {
    app.decorate('prisma', prisma)
  })
}

async function buildTestApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(makePrismaPlugin(prisma))
  await app.register(bankingRoutes, { prefix: '/banking' })
  return app
}

// ── generateOnboardingToken ────────────────────────────────────────────────

describe('generateOnboardingToken', () => {
  it('creates a 64-char hex token', async () => {
    const prisma = makePrisma()
    const token = await generateOnboardingToken(prisma, 'user-uuid')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('stores the token in the database with bank_connect purpose', async () => {
    const prisma = makePrisma()
    await generateOnboardingToken(prisma, 'user-uuid')

    const createCall = (prisma.onboardingToken.create as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ data: { userId: string; purpose: string; expiresAt: Date } }]
    expect(createCall[0].data.userId).toBe('user-uuid')
    expect(createCall[0].data.purpose).toBe('bank_connect')
    expect(createCall[0].data.expiresAt).toBeInstanceOf(Date)
  })

  it('sets expiry 15 minutes in the future', async () => {
    const prisma = makePrisma()
    const before = Date.now()
    await generateOnboardingToken(prisma, 'user-uuid')
    const after = Date.now()

    const createCall = (prisma.onboardingToken.create as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ data: { expiresAt: Date } }]
    const expiresAt = createCall[0].data.expiresAt.getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 100)
    expect(expiresAt).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 100)
  })

  it('generates unique tokens on each call', async () => {
    const prisma = makePrisma()
    const t1 = await generateOnboardingToken(prisma, 'user-uuid')
    const t2 = await generateOnboardingToken(prisma, 'user-uuid')
    expect(t1).not.toBe(t2)
  })
})

// ── validateAndConsumeToken ────────────────────────────────────────────────

describe('validateAndConsumeToken', () => {
  it('returns ok:true and userId for a valid token', async () => {
    const prisma = makePrisma()
    const result = await validateAndConsumeToken(prisma, 'a'.repeat(64))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.userId).toBe('user-uuid')
  })

  it('marks the token as used after validation', async () => {
    const prisma = makePrisma()
    await validateAndConsumeToken(prisma, 'a'.repeat(64))
    const updateCall = (prisma.onboardingToken.update as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ data: { usedAt: Date } }]
    expect(updateCall[0].data.usedAt).toBeInstanceOf(Date)
  })

  it('returns not_found for an unknown token', async () => {
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn(),
      },
    })
    const result = await validateAndConsumeToken(prisma, 'unknown'.repeat(9))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_found')
  })

  it('returns expired for a past-expiry token', async () => {
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(makeToken({ expiresAt: new Date(Date.now() - 1000) })),
        update: vi.fn(),
        create: vi.fn(),
      },
    })
    const result = await validateAndConsumeToken(prisma, 'a'.repeat(64))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })

  it('returns already_used for a consumed token', async () => {
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(makeToken({ usedAt: new Date() })),
        update: vi.fn(),
        create: vi.fn(),
      },
    })
    const result = await validateAndConsumeToken(prisma, 'a'.repeat(64))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('already_used')
  })

  it('does not call update when validation fails', async () => {
    const updateFn = vi.fn()
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(makeToken({ usedAt: new Date() })),
        update: updateFn,
        create: vi.fn(),
      },
    })
    await validateAndConsumeToken(prisma, 'a'.repeat(64))
    expect(updateFn).not.toHaveBeenCalled()
  })
})

// ── logConsentEvent ────────────────────────────────────────────────────────

describe('logConsentEvent', () => {
  it('writes to auditLog with correct fields', async () => {
    const prisma = makePrisma()
    await logConsentEvent(prisma, 'bank_connect_completed', 'user-uuid', { connectionId: 'conn-1' })

    const createCall = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ data: { eventType: string; userId: string; eventData: unknown } }]
    expect(createCall[0].data.eventType).toBe('bank_connect_completed')
    expect(createCall[0].data.userId).toBe('user-uuid')
    expect(createCall[0].data.eventData).toMatchObject({ connectionId: 'conn-1' })
  })

  it('does not throw when auditLog.create fails', async () => {
    const prisma = makePrisma({
      auditLog: { create: vi.fn().mockRejectedValue(new Error('DB error')) },
    })
    await expect(logConsentEvent(prisma, 'bank_connect_completed', null)).resolves.not.toThrow()
  })

  it('accepts null userId for pre-auth events', async () => {
    const prisma = makePrisma()
    await logConsentEvent(prisma, 'bank_connect_token_not_found', null)

    const createCall = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ data: { userId: null } }]
    expect(createCall[0].data.userId).toBeNull()
  })
})

// ── GET /banking/start?token=... ───────────────────────────────────────────

describe('GET /banking/start', () => {
  it('returns 400 HTML when token param is missing', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    const res = await app.inject({ method: 'GET', url: '/banking/start' })
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('returns success HTML when token is valid', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('Bank connected')
  })

  it('returns failure HTML for an expired token', async () => {
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(makeToken({ expiresAt: new Date(Date.now() - 1000) })),
        update: vi.fn(),
        create: vi.fn(),
      },
    })
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('expired')
  })

  it('returns failure HTML for an already-used token', async () => {
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(makeToken({ usedAt: new Date() })),
        update: vi.fn(),
        create: vi.fn(),
      },
    })
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('already used')
  })

  it('returns failure HTML for an unknown token', async () => {
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn(),
      },
    })
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'b'.repeat(64)}`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('not valid')
  })

  it('logs bank_connect_token_opened on successful validation', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    const auditCalls = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { eventType: string } }]>
    const opened = auditCalls.find((c) => c[0].data.eventType === 'bank_connect_token_opened')
    expect(opened).toBeDefined()
  })

  it('logs bank_connect_completed on successful connection', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    const auditCalls = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { eventType: string } }]>
    const completed = auditCalls.find((c) => c[0].data.eventType === 'bank_connect_completed')
    expect(completed).toBeDefined()
  })

  it('logs bank_connect_token_expired for expired tokens', async () => {
    const prisma = makePrisma({
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(makeToken({ expiresAt: new Date(Date.now() - 1) })),
        update: vi.fn(),
        create: vi.fn(),
      },
    })
    const app = await buildTestApp(prisma)
    await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    const auditCalls = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { eventType: string } }]>
    const expiredLog = auditCalls.find((c) => c[0].data.eventType === 'bank_connect_token_expired')
    expect(expiredLog).toBeDefined()
  })

  it('marks token as used so it cannot be reused', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    const updateCall = (prisma.onboardingToken.update as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ data: { usedAt: Date } }]
    expect(updateCall[0].data.usedAt).toBeInstanceOf(Date)
  })

  it('success page shows transaction and account counts', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: `/banking/start?token=${'a'.repeat(64)}`,
    })
    // Counts come from the real MockOpenBankingProvider (90 days of data)
    expect(res.body).toMatch(/\d+ transactions? imported/)
    expect(res.body).toContain('2 account')
  })
})
