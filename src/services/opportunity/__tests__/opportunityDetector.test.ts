/**
 * opportunityDetector tests.
 *
 * Three detection paths:
 *   - Bank-linked: recurring_expense_match (recurring payment → competing offer)
 *   - Bank-linked: balance_analysis (idle current account balance → savings offer)
 *   - No-bank: no_bank_profile (requiresBankLink:false offers surfaced generically)
 *
 * upsertOpportunity idempotency: CONVERTED and DISMISSED opportunities must
 * never be re-surfaced; PENDING/DELIVERED ones should be refreshed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { detectOpportunities } from '../opportunityDetector.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = 'user-00000001'

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-001',
    isActive: true,
    requiresBankLink: true,
    parameters: { monthlyPrice: 15 },
    category: { slug: 'broadband' },
    commissionValue: 30,
    expiresAt: null,
    startsAt: null,
    ...overrides,
  }
}

function makeRecurringPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rp-001',
    userId: USER_ID,
    merchantSlug: 'bt-broadband',
    merchantCategory: 'broadband',
    averageAmount: 40, // £40/month — offer is £15, saving = £25/mo = £300/yr
    cadenceConfidence: 0.95,
    isActive: true,
    ...overrides,
  }
}

function makeAccount(balance: number) {
  return {
    id: 'acc-001',
    userId: USER_ID,
    accountType: 'current',
    currentBalance: balance,
    isActive: true,
  }
}

function makeSavingsOffer() {
  return makeOffer({
    id: 'offer-savings-001',
    category: { slug: 'savings' },
    parameters: { aer: 5 }, // 5% AER
    requiresBankLink: true,
  })
}

interface PrismaOptions {
  hasBankConnection?: boolean
  recurringPayments?: ReturnType<typeof makeRecurringPayment>[]
  matchingOffers?: ReturnType<typeof makeOffer>[]
  accounts?: ReturnType<typeof makeAccount>[]
  savingsOffers?: ReturnType<typeof makeOffer>[]
  existingOpportunity?: Record<string, unknown> | null
  noBankOffers?: ReturnType<typeof makeOffer>[]
}

function makePrisma(opts: PrismaOptions = {}): PrismaClient {
  const connectionCount = opts.hasBankConnection === false ? 0 : 1

  return {
    bankConnection: {
      count: vi.fn().mockResolvedValue(connectionCount),
    },
    recurringPayment: {
      findMany: vi.fn().mockResolvedValue(opts.recurringPayments ?? []),
    },
    offer: {
      // First call: matching offers per recurring payment
      // Second call: savings offers for balance path
      findMany: vi.fn()
        .mockResolvedValueOnce(opts.matchingOffers ?? [])
        .mockResolvedValue(opts.savingsOffers ?? opts.noBankOffers ?? []),
    },
    account: {
      findMany: vi.fn().mockResolvedValue(opts.accounts ?? []),
    },
    opportunity: {
      findUnique: vi.fn().mockResolvedValue(opts.existingOpportunity ?? null),
      create: vi.fn().mockResolvedValue({ id: 'opp-new-001' }),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

// ── detectOpportunities — bank-linked recurring expense path ──────────────────

describe('detectOpportunities — recurring_expense_match', () => {
  it('returns 0 when user has no recurring payments', async () => {
    const prisma = makePrisma({ recurringPayments: [] })
    expect(await detectOpportunities(prisma, USER_ID)).toBe(0)
  })

  it('returns 0 when no matching offers found for a recurring payment', async () => {
    const prisma = makePrisma({
      recurringPayments: [makeRecurringPayment()],
      matchingOffers: [],
    })
    expect(await detectOpportunities(prisma, USER_ID)).toBe(0)
  })

  it('returns 0 when offer is cheaper but saving estimate is zero or negative', async () => {
    // averageAmount = £10, offer monthlyPrice = £15 → saving = -£5 → skipped
    const prisma = makePrisma({
      recurringPayments: [makeRecurringPayment({ averageAmount: 10 })],
      matchingOffers: [makeOffer({ parameters: { monthlyPrice: 15 } })],
    })
    expect(await detectOpportunities(prisma, USER_ID)).toBe(0)
    expect(prisma.opportunity.create).not.toHaveBeenCalled()
  })

  it('creates an opportunity when a cheaper competing offer is found', async () => {
    const prisma = makePrisma({
      recurringPayments: [makeRecurringPayment({ averageAmount: 40 })],
      matchingOffers: [makeOffer({ parameters: { monthlyPrice: 15 } })],
    })
    const count = await detectOpportunities(prisma, USER_ID)
    expect(count).toBe(1)
    expect(prisma.opportunity.create).toHaveBeenCalledOnce()
  })

  it('stores detectionMethod as recurring_expense_match', async () => {
    const prisma = makePrisma({
      recurringPayments: [makeRecurringPayment()],
      matchingOffers: [makeOffer({ parameters: { monthlyPrice: 15 } })],
    })
    await detectOpportunities(prisma, USER_ID)

    const data = (vi.mocked(prisma.opportunity.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.detectionMethod).toBe('recurring_expense_match')
  })

  it('computes annualSavingEstimate correctly: (currentMonthly - offerMonthly) * 12', async () => {
    // £40 - £15 = £25/mo * 12 = £300/yr
    const prisma = makePrisma({
      recurringPayments: [makeRecurringPayment({ averageAmount: 40 })],
      matchingOffers: [makeOffer({ parameters: { monthlyPrice: 15 } })],
    })
    await detectOpportunities(prisma, USER_ID)

    const data = (vi.mocked(prisma.opportunity.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.annualSavingEstimate).toBe(300)
  })

  it('creates one opportunity per matched (payment, offer) pair', async () => {
    const prisma = makePrisma({
      recurringPayments: [makeRecurringPayment()],
      matchingOffers: [
        makeOffer({ id: 'offer-001', parameters: { monthlyPrice: 15 } }),
        makeOffer({ id: 'offer-002', parameters: { monthlyPrice: 20 } }),
      ],
    })
    // Second offer: £40 - £20 = £20/mo saving, still positive
    const count = await detectOpportunities(prisma, USER_ID)
    expect(count).toBe(2)
  })
})

// ── detectOpportunities — balance_analysis path ───────────────────────────────

describe('detectOpportunities — balance_analysis', () => {
  it('skips accounts with balance below £1000', async () => {
    const prisma = makePrisma({
      recurringPayments: [],
      accounts: [makeAccount(500)],
      savingsOffers: [makeSavingsOffer()],
    })
    // findMany returns [] for recurring, so we need to handle mock ordering
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(1) },
      recurringPayment: { findMany: vi.fn().mockResolvedValue([]) },
      offer: { findMany: vi.fn().mockResolvedValue([makeSavingsOffer()]) },
      account: { findMany: vi.fn().mockResolvedValue([makeAccount(500)]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    const count = await detectOpportunities(p, USER_ID)
    expect(count).toBe(0)
    expect(p.opportunity.create).not.toHaveBeenCalled()
  })

  it('creates a savings opportunity for accounts with balance ≥ £1000', async () => {
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(1) },
      recurringPayment: { findMany: vi.fn().mockResolvedValue([]) },
      offer: { findMany: vi.fn().mockResolvedValue([makeSavingsOffer()]) },
      account: { findMany: vi.fn().mockResolvedValue([makeAccount(5000)]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    const count = await detectOpportunities(p, USER_ID)
    expect(count).toBe(1)
    expect(p.opportunity.create).toHaveBeenCalledOnce()
  })

  it('stores detectionMethod as balance_analysis', async () => {
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(1) },
      recurringPayment: { findMany: vi.fn().mockResolvedValue([]) },
      offer: { findMany: vi.fn().mockResolvedValue([makeSavingsOffer()]) },
      account: { findMany: vi.fn().mockResolvedValue([makeAccount(5000)]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    await detectOpportunities(p, USER_ID)

    const data = (vi.mocked(p.opportunity.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.detectionMethod).toBe('balance_analysis')
  })

  it('computes annualInterest correctly: balance * (aer / 100)', async () => {
    // £5000 * 5% = £250
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(1) },
      recurringPayment: { findMany: vi.fn().mockResolvedValue([]) },
      offer: { findMany: vi.fn().mockResolvedValue([makeSavingsOffer()]) },
      account: { findMany: vi.fn().mockResolvedValue([makeAccount(5000)]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    await detectOpportunities(p, USER_ID)

    const data = (vi.mocked(p.opportunity.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.annualSavingEstimate).toBe(250)
  })

  it('skips savings offers with aer:0', async () => {
    const zeroAerOffer = makeOffer({ id: 'offer-zero-aer', category: { slug: 'savings' }, parameters: { aer: 0 } })
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(1) },
      recurringPayment: { findMany: vi.fn().mockResolvedValue([]) },
      offer: { findMany: vi.fn().mockResolvedValue([zeroAerOffer]) },
      account: { findMany: vi.fn().mockResolvedValue([makeAccount(5000)]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    const count = await detectOpportunities(p, USER_ID)
    expect(count).toBe(0)
  })
})

// ── detectOpportunities — no-bank user path ───────────────────────────────────

describe('detectOpportunities — no_bank_profile', () => {
  it('takes the no-bank path when user has no active bank connection', async () => {
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(0) },
      offer: { findMany: vi.fn().mockResolvedValue([makeOffer({ requiresBankLink: false })]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    const count = await detectOpportunities(p, USER_ID)
    expect(count).toBe(1)
  })

  it('stores detectionMethod as no_bank_profile', async () => {
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(0) },
      offer: { findMany: vi.fn().mockResolvedValue([makeOffer({ requiresBankLink: false })]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    await detectOpportunities(p, USER_ID)

    const data = (vi.mocked(p.opportunity.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.detectionMethod).toBe('no_bank_profile')
    expect(data.savingConfidence).toBe(0.4)
  })

  it('returns 0 when no no-bank offers are available', async () => {
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(0) },
      offer: { findMany: vi.fn().mockResolvedValue([]) },
      opportunity: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    } as unknown as PrismaClient

    expect(await detectOpportunities(p, USER_ID)).toBe(0)
  })
})

// ── upsertOpportunity idempotency ─────────────────────────────────────────────

describe('upsertOpportunity — idempotency', () => {
  function pWithExisting(status: string) {
    return {
      bankConnection: { count: vi.fn().mockResolvedValue(0) },
      offer: { findMany: vi.fn().mockResolvedValue([makeOffer({ requiresBankLink: false })]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue({ id: 'opp-existing', status }),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient
  }

  it('does NOT re-surface a CONVERTED opportunity', async () => {
    const p = pWithExisting('CONVERTED')
    await detectOpportunities(p, USER_ID)
    expect(p.opportunity.create).not.toHaveBeenCalled()
    expect(p.opportunity.update).not.toHaveBeenCalled()
  })

  it('does NOT re-surface a DISMISSED opportunity', async () => {
    const p = pWithExisting('DISMISSED')
    await detectOpportunities(p, USER_ID)
    expect(p.opportunity.create).not.toHaveBeenCalled()
    expect(p.opportunity.update).not.toHaveBeenCalled()
  })

  it('refreshes (updates) a PENDING opportunity without creating a duplicate', async () => {
    const p = pWithExisting('PENDING')
    await detectOpportunities(p, USER_ID)
    expect(p.opportunity.update).toHaveBeenCalledOnce()
    expect(p.opportunity.create).not.toHaveBeenCalled()
  })

  it('refreshes (updates) a DELIVERED opportunity', async () => {
    const p = pWithExisting('DELIVERED')
    await detectOpportunities(p, USER_ID)
    expect(p.opportunity.update).toHaveBeenCalledOnce()
    expect(p.opportunity.create).not.toHaveBeenCalled()
  })

  it('creates when no existing opportunity exists', async () => {
    const p = {
      bankConnection: { count: vi.fn().mockResolvedValue(0) },
      offer: { findMany: vi.fn().mockResolvedValue([makeOffer({ requiresBankLink: false })]) },
      opportunity: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'opp-new' }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient

    await detectOpportunities(p, USER_ID)
    expect(p.opportunity.create).toHaveBeenCalledOnce()
    expect(p.opportunity.update).not.toHaveBeenCalled()
  })
})
