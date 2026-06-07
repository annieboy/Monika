import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Account } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { syncAccounts, syncTransactions, runFullSync } from '../sync.js'
import { MockOpenBankingProvider, MOCK_ACCOUNTS, MOCK_CONSENT } from '../providers/mock.js'

// ── Mock Prisma factory ────────────────────────────────────────────────────

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

// ── Provider ───────────────────────────────────────────────────────────────

const provider = new MockOpenBankingProvider()

// ── syncAccounts ───────────────────────────────────────────────────────────

describe('syncAccounts', () => {
  it('upserts one row per provider account', async () => {
    const prisma = makePrisma()
    const accounts = await syncAccounts(prisma, 'conn-id', 'user-id', MOCK_CONSENT, provider)

    expect(accounts).toHaveLength(2)
    expect(prisma.account.upsert).toHaveBeenCalledTimes(2)
  })

  it('creates a current account with correct type', async () => {
    const prisma = makePrisma()
    await syncAccounts(prisma, 'conn-id', 'user-id', MOCK_CONSENT, provider)

    const calls = (prisma.account.upsert as ReturnType<typeof vi.fn>).mock.calls as Array<
      [{ create: { accountType: string; displayName: string; providerAccountId: string } }]
    >
    const currentCall = calls.find((c) => c[0].create.providerAccountId === 'mock-account-current')
    expect(currentCall).toBeDefined()
    expect(currentCall![0].create.accountType).toBe('current')
    expect(currentCall![0].create.displayName).toBe('Personal Current Account')
  })

  it('creates a savings account with correct type', async () => {
    const prisma = makePrisma()
    await syncAccounts(prisma, 'conn-id', 'user-id', MOCK_CONSENT, provider)

    const calls = (prisma.account.upsert as ReturnType<typeof vi.fn>).mock.calls as Array<
      [{ create: { accountType: string; providerAccountId: string } }]
    >
    const savingsCall = calls.find((c) => c[0].create.providerAccountId === 'mock-account-savings')
    expect(savingsCall).toBeDefined()
    expect(savingsCall![0].create.accountType).toBe('savings')
  })
})

// ── MockOpenBankingProvider — transaction generation ───────────────────────

describe('MockOpenBankingProvider.getTransactions', () => {
  const from = new Date(Date.now() - 90 * 86_400_000)
  const to = new Date()

  it('returns transactions for the current account', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    expect(txns.length).toBeGreaterThan(0)
  })

  it('returns transactions for the savings account', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-savings', from, to)
    expect(txns.length).toBeGreaterThan(0)
  })

  it('returns empty array for unknown account', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'unknown-account', from, to)
    expect(txns).toHaveLength(0)
  })

  it('includes salary credits in current account', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    const salaries = txns.filter((t) => t.isSalary)
    expect(salaries.length).toBeGreaterThan(0)
    expect(salaries[0]!.amount).toBeGreaterThan(0)
    expect(salaries[0]!.transactionType).toBe('credit')
  })

  it('includes rent debits in current account', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    const rent = txns.filter((t) => t.category === 'rent')
    expect(rent.length).toBeGreaterThan(0)
    expect(rent[0]!.amount).toBeLessThan(0)
  })

  it('includes subscription transactions', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    const subs = txns.filter((t) => t.isSubscription)
    expect(subs.length).toBeGreaterThan(0)
    const names = subs.map((t) => t.merchantName)
    expect(names).toContain('Netflix')
    expect(names).toContain('Spotify')
  })

  it('includes grocery transactions', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    const groceries = txns.filter((t) => t.category === 'groceries')
    expect(groceries.length).toBeGreaterThan(0)
  })

  it('includes transport transactions', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    const transport = txns.filter((t) => t.category === 'transport')
    expect(transport.length).toBeGreaterThan(0)
  })

  it('all transactions have required fields', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    for (const t of txns) {
      expect(t.providerTransactionId).toBeTruthy()
      expect(typeof t.amount).toBe('number')
      expect(t.transactionDate).toBeInstanceOf(Date)
      expect(t.rawDescription).toBeTruthy()
      expect(t.currency).toBe('GBP')
    }
  })

  it('all providerTransactionIds are unique within an account', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    const ids = txns.map((t) => t.providerTransactionId)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('returns roughly 90 days of data (at least 50 transactions)', async () => {
    const txns = await provider.getTransactions(MOCK_CONSENT, 'mock-account-current', from, to)
    expect(txns.length).toBeGreaterThan(50)
  })
})

// ── syncTransactions ───────────────────────────────────────────────────────

describe('syncTransactions', () => {
  const account = makeAccount()
  const from = new Date(Date.now() - 90 * 86_400_000)

  it('imports transactions and returns correct counts', async () => {
    const prisma = makePrisma()
    const result = await syncTransactions(prisma, account, MOCK_CONSENT, provider, from)

    expect(result.errors).toHaveLength(0)
    expect(result.imported).toBeGreaterThan(50)
    expect(result.skipped).toBe(0)
  })

  it('skips duplicate transactions on second sync (dedup by providerTransactionId)', async () => {
    // First call: findFirst returns null (new), second call: returns existing
    let callCount = 0
    const prisma = makePrisma({
      transaction: {
        findFirst: vi.fn().mockImplementation(() => {
          callCount++
          // Return existing after the first call
          return Promise.resolve(callCount > 1 ? { id: 'existing-txn' } : null)
        }),
        create: vi.fn().mockResolvedValue({ id: 'txn-uuid' }),
      },
    })

    const result = await syncTransactions(prisma, account, MOCK_CONSENT, provider, from)
    // Only the first transaction should have been created
    expect(prisma.transaction.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
    expect(result.skipped).toBeGreaterThan(0)
  })

  it('does not create any transaction when all already exist', async () => {
    const prisma = makePrisma({
      transaction: {
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-txn' }),
        create: vi.fn().mockResolvedValue({ id: 'txn-uuid' }),
      },
    })

    const result = await syncTransactions(prisma, account, MOCK_CONSENT, provider, from)
    expect(prisma.transaction.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    expect(result.imported).toBe(0)
    expect(result.skipped).toBeGreaterThan(0)
  })

  it('stores transactions linked to the correct account userId', async () => {
    const accountWithUser = makeAccount({ id: 'acct-123', userId: 'user-456' })
    const prisma = makePrisma()

    await syncTransactions(prisma, accountWithUser, MOCK_CONSENT, provider, from)

    const createCalls = (prisma.transaction.create as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { accountId: string; userId: string } }]>

    for (const [call] of createCalls) {
      expect(call.data.accountId).toBe('acct-123')
      expect(call.data.userId).toBe('user-456')
    }
  })

  it('stores debit amounts as negative Decimal values', async () => {
    const prisma = makePrisma()
    await syncTransactions(prisma, account, MOCK_CONSENT, provider, from)

    const createCalls = (prisma.transaction.create as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { amount: Decimal; transactionType: string } }]>

    const debits = createCalls.filter((c) => c[0].data.transactionType === 'debit')
    expect(debits.length).toBeGreaterThan(0)
    for (const [call] of debits) {
      expect(call.data.amount.toNumber()).toBeLessThan(0)
    }
  })

  it('stores credit amounts as positive Decimal values', async () => {
    const prisma = makePrisma()
    await syncTransactions(prisma, account, MOCK_CONSENT, provider, from)

    const createCalls = (prisma.transaction.create as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { amount: Decimal; transactionType: string } }]>

    const credits = createCalls.filter((c) => c[0].data.transactionType === 'credit')
    expect(credits.length).toBeGreaterThan(0)
    for (const [call] of credits) {
      expect(call.data.amount.toNumber()).toBeGreaterThan(0)
    }
  })

  it('sets category and categoryMethod for categorised transactions', async () => {
    const prisma = makePrisma()
    await syncTransactions(prisma, account, MOCK_CONSENT, provider, from)

    const createCalls = (prisma.transaction.create as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { category: string | null; categoryMethod: string | null } }]>

    const categorised = createCalls.filter((c) => c[0].data.category !== null)
    expect(categorised.length).toBeGreaterThan(0)
    for (const [call] of categorised) {
      expect(call.data.categoryMethod).toBe('rule')
    }
  })
})

// ── runFullSync ────────────────────────────────────────────────────────────

describe('runFullSync', () => {
  it('syncs both accounts and returns aggregate counts', async () => {
    const prisma = makePrisma()
    const result = await runFullSync(
      prisma,
      'connection-uuid',
      'user-uuid',
      MOCK_CONSENT,
      provider,
    )

    expect(result.accountsSynced).toBe(2)
    expect(result.transactionsImported).toBeGreaterThan(50)
    expect(result.transactionsSkipped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('updates bankConnection sync metadata after sync', async () => {
    const prisma = makePrisma()
    await runFullSync(prisma, 'connection-uuid', 'user-uuid', MOCK_CONSENT, provider)

    expect(prisma.bankConnection.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'connection-uuid' },
        data: expect.objectContaining({ lastSyncAt: expect.any(Date), lastSyncStatus: 'success' }),
      }),
    )
  })
})

// ── MOCK_ACCOUNTS constant ────────────────────────────────────────────────

describe('MOCK_ACCOUNTS', () => {
  it('has exactly 2 accounts', () => {
    expect(MOCK_ACCOUNTS).toHaveLength(2)
  })

  it('has one current and one savings account', () => {
    const types = MOCK_ACCOUNTS.map((a) => a.accountType)
    expect(types).toContain('current')
    expect(types).toContain('savings')
  })

  it('all accounts have GBP currency', () => {
    for (const a of MOCK_ACCOUNTS) {
      expect(a.currency).toBe('GBP')
    }
  })
})
