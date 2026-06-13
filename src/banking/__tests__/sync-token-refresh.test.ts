/**
 * Tests for uncovered branches in sync.ts:
 *  - ensureFreshToken token refresh path (lines 20-43)
 *  - syncTransactions error push (line 117)
 *  - runFullSync firstError in analytics payload (line 231)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Account } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

// ── Mocks (must be declared before module imports) ─────────────────────────

vi.mock('../../lib/crypto.js', () => ({
  transactionDedupHash: vi.fn().mockReturnValue('mock-hash'),
  encrypt: vi.fn().mockReturnValue(new Uint8Array(32)),
}))

vi.mock('../../config.js', () => ({
  config: {
    ENCRYPTION_KEY: 'a'.repeat(64),
  },
}))

vi.mock('../../services/analytics/events.js', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}))

import { syncTransactions, runFullSync } from '../sync.js'
import { trackEvent } from '../../services/analytics/events.js'
import type { OpenBankingProvider, ProviderConsent, ProviderTransaction } from '../types.js'
import { MOCK_ACCOUNTS, MOCK_CONSENT } from '../providers/mock.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-uuid',
    connectionId: 'connection-uuid',
    userId: 'user-uuid',
    providerAccountId: 'mock-account-current',
    accountType: 'current',
    displayName: 'Personal Current Account',
    currency: 'GBP',
    currentBalance: new Decimal('1847.32'),
    availableBalance: new Decimal('1847.32'),
    creditLimit: null,
    balanceUpdatedAt: new Date(),
    accountNumberEnc: null,
    sortCodeEnc: null,
    accountLast4: '4782',
    isPrimary: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    account: {
      upsert: vi.fn().mockImplementation(({ create }: { create: { providerAccountId: string } }) =>
        Promise.resolve(makeAccount({ providerAccountId: create.providerAccountId })),
      ),
    },
    transaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'txn-uuid' }),
    },
    bankConnection: {
      update: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as PrismaClient
}

const SINGLE_TRANSACTION: ProviderTransaction = {
  providerTransactionId: 'txn-001',
  amount: -10.00,
  currency: 'GBP',
  transactionType: 'debit',
  status: 'settled',
  transactionDate: new Date(),
  rawDescription: 'Test debit',
}

// ── ensureFreshToken — token refresh path ─────────────────────────────────

describe('ensureFreshToken (via runFullSync)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls provider.refreshToken when token is already expired', async () => {
    const expiredConsent: ProviderConsent = {
      ...MOCK_CONSENT,
      tokenExpiresAt: new Date(Date.now() - 1000), // 1 second in the past
    }

    const refreshedConsent: ProviderConsent = {
      ...MOCK_CONSENT,
      accessToken: 'new-access-token',
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }

    const mockRefreshToken = vi.fn().mockResolvedValue(refreshedConsent)
    const provider: OpenBankingProvider = {
      providerName: 'mock',
      initiateConsent: vi.fn(),
      exchangeCode: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
      getTransactions: vi.fn().mockResolvedValue([]),
      refreshToken: mockRefreshToken,
    }

    const prisma = makePrisma()
    await runFullSync(prisma, 'conn-id', 'user-id', expiredConsent, provider)

    expect(mockRefreshToken).toHaveBeenCalledWith(expiredConsent)
  })

  it('updates bankConnection with new accessTokenEnc after refresh', async () => {
    const expiredConsent: ProviderConsent = {
      ...MOCK_CONSENT,
      tokenExpiresAt: new Date(Date.now() - 1000),
    }

    const refreshedConsent: ProviderConsent = {
      ...MOCK_CONSENT,
      accessToken: 'new-access-token',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    }

    const provider: OpenBankingProvider = {
      providerName: 'mock',
      initiateConsent: vi.fn(),
      exchangeCode: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
      getTransactions: vi.fn().mockResolvedValue([]),
      refreshToken: vi.fn().mockResolvedValue(refreshedConsent),
    }

    const prisma = makePrisma()
    await runFullSync(prisma, 'conn-id', 'user-id', expiredConsent, provider)

    const updateCalls = (prisma.bankConnection.update as ReturnType<typeof vi.fn>).mock.calls as Array<
      [{ where: { id: string }; data: Record<string, unknown> }]
    >

    // First update should be the token refresh update
    const tokenUpdateCall = updateCalls.find(([c]) =>
      Object.prototype.hasOwnProperty.call(c.data, 'accessTokenEnc'),
    )
    expect(tokenUpdateCall).toBeDefined()
    expect(tokenUpdateCall![0].where).toEqual({ id: 'conn-id' })
  })

  it('encrypts and stores refreshToken when provider returns one', async () => {
    const expiredConsent: ProviderConsent = {
      ...MOCK_CONSENT,
      tokenExpiresAt: new Date(Date.now() - 1000),
    }

    const refreshedConsent: ProviderConsent = {
      ...MOCK_CONSENT,
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    }

    const provider: OpenBankingProvider = {
      providerName: 'mock',
      initiateConsent: vi.fn(),
      exchangeCode: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
      getTransactions: vi.fn().mockResolvedValue([]),
      refreshToken: vi.fn().mockResolvedValue(refreshedConsent),
    }

    const prisma = makePrisma()
    await runFullSync(prisma, 'conn-id', 'user-id', expiredConsent, provider)

    const { encrypt } = await import('../../lib/crypto.js')
    // encrypt called for both accessToken and refreshToken
    expect(encrypt).toHaveBeenCalledWith(
      Buffer.from('new-access-token', 'utf-8'),
      expect.anything(),
    )
    expect(encrypt).toHaveBeenCalledWith(
      Buffer.from('new-refresh-token', 'utf-8'),
      expect.anything(),
    )
  })

  it('does NOT call refreshToken when token expires far in the future', async () => {
    const freshConsent: ProviderConsent = {
      ...MOCK_CONSENT,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour away
    }

    const mockRefreshToken = vi.fn()
    const provider: OpenBankingProvider = {
      providerName: 'mock',
      initiateConsent: vi.fn(),
      exchangeCode: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue(MOCK_ACCOUNTS),
      getTransactions: vi.fn().mockResolvedValue([]),
      refreshToken: mockRefreshToken,
    }

    const prisma = makePrisma()
    await runFullSync(prisma, 'conn-id', 'user-id', freshConsent, provider)

    expect(mockRefreshToken).not.toHaveBeenCalled()
  })
})

// ── syncTransactions error handling (line 117) ─────────────────────────────

describe('syncTransactions error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pushes error to errors array when upsertTransaction throws', async () => {
    const prisma = makePrisma({
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error('DB write failed')),
      },
    })

    const provider: OpenBankingProvider = {
      providerName: 'mock',
      initiateConsent: vi.fn(),
      exchangeCode: vi.fn(),
      getAccounts: vi.fn(),
      getTransactions: vi.fn().mockResolvedValue([SINGLE_TRANSACTION]),
      refreshToken: vi.fn(),
    }

    const account = makeAccount()
    const from = new Date(Date.now() - 90 * 86_400_000)

    const result = await syncTransactions(prisma, account, MOCK_CONSENT, provider, from)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('txn-001')
    expect(result.errors[0]).toContain('DB write failed')
    expect(result.imported).toBe(0)
  })
})

// ── runFullSync firstError in analytics payload (line 231) ─────────────────

describe('runFullSync with transaction errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes firstError in analytics event when a transaction fails', async () => {
    const prisma = makePrisma({
      account: {
        upsert: vi.fn().mockImplementation(({ create }: { create: { providerAccountId: string } }) =>
          Promise.resolve(makeAccount({ providerAccountId: create.providerAccountId })),
        ),
      },
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error('constraint violation')),
      },
      bankConnection: {
        update: vi.fn().mockResolvedValue({}),
      },
    })

    const provider: OpenBankingProvider = {
      providerName: 'mock',
      initiateConsent: vi.fn(),
      exchangeCode: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue([MOCK_ACCOUNTS[0]!]),
      getTransactions: vi.fn().mockResolvedValue([SINGLE_TRANSACTION]),
      refreshToken: vi.fn(),
    }

    const result = await runFullSync(prisma, 'conn-id', 'user-id', MOCK_CONSENT, provider)

    expect(result.errors).toHaveLength(1)
    expect(trackEvent).toHaveBeenCalledWith(
      expect.anything(),
      'sync_error',
      'user-id',
      expect.objectContaining({ firstError: expect.any(String) }),
    )
  })

  it('sets lastSyncStatus to partial when there are errors', async () => {
    const prisma = makePrisma({
      account: {
        upsert: vi.fn().mockImplementation(({ create }: { create: { providerAccountId: string } }) =>
          Promise.resolve(makeAccount({ providerAccountId: create.providerAccountId })),
        ),
      },
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error('write failed')),
      },
      bankConnection: {
        update: vi.fn().mockResolvedValue({}),
      },
    })

    const provider: OpenBankingProvider = {
      providerName: 'mock',
      initiateConsent: vi.fn(),
      exchangeCode: vi.fn(),
      getAccounts: vi.fn().mockResolvedValue([MOCK_ACCOUNTS[0]!]),
      getTransactions: vi.fn().mockResolvedValue([SINGLE_TRANSACTION]),
      refreshToken: vi.fn(),
    }

    await runFullSync(prisma, 'conn-id', 'user-id', MOCK_CONSENT, provider)

    expect(prisma.bankConnection.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncStatus: 'partial' }),
      }),
    )
  })
})
