import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import adminRoutes from '../index.js'

// ── Mock Prisma ────────────────────────────────────────────────────────────────

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    whatsappPhoneHash: 'a'.repeat(64),
    whatsappWabaId: 'waba-id',
    onboardingStatus: 'active',
    fullNameEnc: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  }
}

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cccccccc-0000-0000-0000-000000000001',
    userId: 'aaaaaaaa-0000-0000-0000-000000000001',
    provider: 'mock',
    providerConsentId: 'consent-id',
    bankId: 'mock-bank',
    bankDisplayName: 'Mock Bank',
    consentStatus: 'active',
    consentScopes: ['accounts', 'transactions'],
    lastSyncAt: new Date('2026-01-02T00:00:00Z'),
    lastSyncStatus: 'success',
    lastSyncError: null,
    accessTokenEnc: Buffer.from('enc'),
    refreshTokenEnc: null,
    tokenExpiresAt: null,
    syncCursor: null,
    bankLogoUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    accounts: [
      {
        id: 'acct-uuid',
        displayName: 'Current Account',
        accountType: 'current',
        currentBalance: new Decimal('1234.56'),
        availableBalance: new Decimal('1000.00'),
        isPrimary: true,
        providerAccountId: 'prov-acct-1',
      },
    ],
    ...overrides,
  }
}

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tttttttt-0000-0000-0000-000000000001',
    accountId: 'acct-uuid',
    userId: 'aaaaaaaa-0000-0000-0000-000000000001',
    providerTransactionId: 'prov-txn-1',
    providerRawData: null,
    amount: new Decimal('-42.50'),
    currency: 'GBP',
    transactionType: 'debit',
    status: 'settled',
    merchantName: 'Tesco',
    merchantNameClean: 'Tesco',
    merchantCategoryCode: null,
    merchantLogoUrl: null,
    transactionDate: new Date('2026-01-15'),
    valueDate: null,
    category: 'groceries',
    categoryConfidence: new Decimal('0.95'),
    categoryMethod: 'rule',
    subcategory: null,
    rawDescription: 'TESCO STORES 1234',
    cleanDescription: 'Tesco',
    isRecurring: false,
    subscriptionName: null,
    dedupHash: 'd'.repeat(64),
    account: { displayName: 'Current Account', accountType: 'current' },
    user: { id: 'aaaaaaaa-0000-0000-0000-000000000001', whatsappPhoneHash: 'a'.repeat(64) },
    ...overrides,
  }
}

function makeAuditEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(1),
    userId: 'aaaaaaaa-0000-0000-0000-000000000001',
    eventType: 'bank_connect_completed',
    eventData: { connectionId: 'conn-1' },
    serviceName: 'onboarding',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: { id: 'aaaaaaaa-0000-0000-0000-000000000001', whatsappPhoneHash: 'a'.repeat(64) },
    ...overrides,
  }
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cccc-1',
    userId: 'aaaaaaaa-0000-0000-0000-000000000001',
    sessionId: 'sess-1',
    role: 'user',
    content: 'How much did I spend?',
    contentTokens: null,
    toolCalls: null,
    toolResults: null,
    modelUsed: null,
    latencyMs: null,
    waMessageId: 'wa-msg-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  const user = makeUser()
  const conn = makeConnection()
  const txn = makeTransaction()
  const audit = makeAuditEvent()

  return {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ ...user, _count: { bankConnections: 1, conversations: 5, transactions: 300 } }]),
      findUnique: vi.fn().mockResolvedValue({
        ...user,
        bankConnections: [conn],
        conversations: [makeConversation()],
        auditLogs: [audit],
        onboardingTokens: [
          { purpose: 'bank_connect', expiresAt: new Date(Date.now() + 900_000), usedAt: null, createdAt: new Date() },
        ],
        _count: { transactions: 300 },
      }),
    },
    bankConnection: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([conn]),
    },
    transaction: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([txn]),
      findUnique: vi.fn().mockResolvedValue(txn),
    },
    conversation: {
      count: vi.fn().mockResolvedValue(5),
    },
    auditLog: {
      count: vi.fn().mockResolvedValue(3),
      findMany: vi.fn().mockResolvedValue([audit]),
      groupBy: vi.fn().mockResolvedValue([{ eventType: 'bank_connect_completed' }]),
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
  await app.register(adminRoutes, { prefix: '/admin' })
  return app
}

const VALID_AUTH = 'Basic ' + Buffer.from('testadmin:testpassword1').toString('base64')
const WRONG_AUTH = 'Basic ' + Buffer.from('testadmin:wrongpassword').toString('base64')
const NO_AUTH = undefined

// ── Access control ─────────────────────────────────────────────────────────────

describe('Admin dashboard — access control', () => {
  it('returns 401 when no Authorization header', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: '/admin/' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for wrong password', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/',
      headers: { Authorization: WRONG_AUTH },
    })
    expect(res.statusCode).toBe(401)
  })

  it('sets WWW-Authenticate header on 401', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: '/admin/' })
    expect(res.headers['www-authenticate']).toContain('Basic')
    expect(res.headers['www-authenticate']).toContain('Monika Admin')
  })

  it('returns 200 with correct credentials', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns HTML content-type for dashboard', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('protects /admin/users without credentials', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: '/admin/users' })
    expect(res.statusCode).toBe(401)
  })

  it('protects /admin/transactions without credentials', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: '/admin/transactions' })
    expect(res.statusCode).toBe(401)
  })

  it('protects /admin/audit without credentials', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({ method: 'GET', url: '/admin/audit' })
    expect(res.statusCode).toBe(401)
  })

  it('logout returns 401 to clear browser credentials', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/logout',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── Dashboard page ─────────────────────────────────────────────────────────────

describe('Admin dashboard — dashboard page', () => {
  it('shows user count', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).toContain('1') // user count
    expect(res.body).toContain('Dashboard')
  })

  it('shows recent audit events', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).toContain('bank_connect_completed')
  })
})

// ── Users list ─────────────────────────────────────────────────────────────────

describe('Admin dashboard — users list', () => {
  it('renders users table', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('aaaaaaaa')
    expect(res.body).toContain('active')
  })

  it('accepts phone search parameter', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users?phone=07700900000',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
    // findMany should have been called with a hashed phone filter
    const findMany = prisma.user.findMany as ReturnType<typeof vi.fn>
    const callArg = findMany.mock.calls[0]?.[0] as { where?: { whatsappPhoneHash?: string } }
    expect(callArg?.where?.whatsappPhoneHash).toHaveLength(64)
    expect(callArg?.where?.whatsappPhoneHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('shows "no users found" when result is empty', async () => {
    const prisma = makePrisma({ user: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    }})
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).toContain('No users found')
  })
})

// ── User detail ────────────────────────────────────────────────────────────────

describe('Admin dashboard — user detail', () => {
  it('shows user detail page with bank connection', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/aaaaaaaa-0000-0000-0000-000000000001',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Mock Bank')
    expect(res.body).toContain('Current Account')
    expect(res.body).toContain('1234.56')
  })

  it('shows message conversation', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/aaaaaaaa-0000-0000-0000-000000000001',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).toContain('How much did I spend?')
  })

  it('shows audit log entries for the user', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/aaaaaaaa-0000-0000-0000-000000000001',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).toContain('bank_connect_completed')
  })

  it('does not show encrypted token values', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/aaaaaaaa-0000-0000-0000-000000000001',
      headers: { Authorization: VALID_AUTH },
    })
    // The token column itself is never included — only metadata
    expect(res.body).not.toContain('accessTokenEnc')
    expect(res.body).not.toContain('refreshTokenEnc')
  })

  it('returns 404 for unknown user', async () => {
    const prisma = makePrisma({ user: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    }})
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/nonexistent',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── Transactions ───────────────────────────────────────────────────────────────

describe('Admin dashboard — transactions', () => {
  it('renders transaction list', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/transactions',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Tesco')
    expect(res.body).toContain('42.50')
    expect(res.body).toContain('groceries')
  })

  it('accepts userId filter', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/transactions?userId=aaaaaaaa-0000-0000-0000-000000000001',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
    const findMany = prisma.transaction.findMany as ReturnType<typeof vi.fn>
    const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, string> })?.where
    expect(where?.['userId']).toBe('aaaaaaaa-0000-0000-0000-000000000001')
  })

  it('shows transaction detail page', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/transactions/tttttttt-0000-0000-0000-000000000001',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Tesco')
    expect(res.body).toContain('TESCO STORES 1234')
    expect(res.body).toContain('groceries')
    expect(res.body).toContain('2026-01-15')
  })

  it('returns 404 for unknown transaction', async () => {
    const prisma = makePrisma({ transaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    }})
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/transactions/nonexistent',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── Audit log ──────────────────────────────────────────────────────────────────

describe('Admin dashboard — audit log', () => {
  it('renders audit log page', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('bank_connect_completed')
    expect(res.body).toContain('Audit Log')
  })

  it('shows event type filter dropdown', async () => {
    const app = await buildTestApp(makePrisma())
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).toContain('<select')
    expect(res.body).toContain('bank_connect_completed')
  })

  it('accepts eventType filter', async () => {
    const prisma = makePrisma()
    const app = await buildTestApp(prisma)
    await app.inject({
      method: 'GET',
      url: '/admin/audit?eventType=bank_connect_completed',
      headers: { Authorization: VALID_AUTH },
    })
    const findMany = prisma.auditLog.findMany as ReturnType<typeof vi.fn>
    const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, string> })?.where
    expect(where?.['eventType']).toBe('bank_connect_completed')
  })
})

// ── HTML safety ────────────────────────────────────────────────────────────────

describe('Admin dashboard — HTML safety', () => {
  it('escapes merchant name XSS attempt in transaction list', async () => {
    const prisma = makePrisma({
      transaction: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          makeTransaction({ merchantName: '<script>alert(1)</script>' }),
        ]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    })
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/transactions',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).not.toContain('<script>')
    expect(res.body).toContain('&lt;script&gt;')
  })

  it('escapes user phone hash in users list', async () => {
    const prisma = makePrisma({
      user: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { ...makeUser({ whatsappPhoneHash: '<img src=x onerror=alert(1)>' + 'a'.repeat(30) }), _count: { bankConnections: 0, conversations: 0, transactions: 0 } },
        ]),
      },
    })
    const app = await buildTestApp(prisma)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { Authorization: VALID_AUTH },
    })
    expect(res.body).not.toContain('<img src=x')
    expect(res.body).toContain('&lt;img')
  })
})
