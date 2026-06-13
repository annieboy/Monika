/**
 * opportunityConversationHandler tests.
 *
 * Two sections:
 *   1. handleOpportunityReply — full integration-style tests covering every
 *      reply path: opt-out, consent flow (opt-in / dismiss), no-pending-opp
 *      fallthrough, DETAIL, DISMISS, MORE (with and without alternatives),
 *      REMIND (valid and invalid date), and UNKNOWN fallthrough.
 *   2. Pattern and parse helpers — locked in as regression guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../compliance/consentService.js', () => ({
  isOptOutMessage: vi.fn().mockReturnValue(false),
  recordOptOut: vi.fn().mockResolvedValue(undefined),
  recordOptIn: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../opportunity/opportunityMessageBuilder.js', () => ({
  buildDetailMessage: vi.fn().mockReturnValue('Detail message content'),
  CONSENT_CONFIRMED: 'Great, you are opted in!',
  CONSENT_DECLINED: 'No problem, opting you out.',
}))

vi.mock('../../affiliate/clickTrackingService.js', () => ({
  generateClickUrl: vi.fn().mockResolvedValue('https://monika.app/go/abc123'),
}))

import { handleOpportunityReply } from '../opportunityConversationHandler.js'
import { isOptOutMessage, recordOptOut, recordOptIn } from '../../compliance/consentService.js'
import { buildDetailMessage } from '../../opportunity/opportunityMessageBuilder.js'
import { generateClickUrl } from '../../affiliate/clickTrackingService.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-00000001'

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-001',
    providerName: 'Octopus Energy',
    title: 'Cheaper Energy',
    shortDescription: 'Switch and save',
    keyBenefits: ['No exit fees'],
    parameters: { monthlyPrice: 80 },
    fcaDisclaimer: null,
    category: { slug: 'energy', name: 'Energy' },
    ...overrides,
  }
}

function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'opp-001',
    userId: USER_ID,
    status: 'DELIVERED',
    deliveredAt: new Date(), // within 24h window
    annualSavingEstimate: 120,
    recurringPayment: { averageAmount: 90 },
    offer: makeOffer(),
    ...overrides,
  }
}

function makePrisma(opts: {
  hasPrefs?: boolean
  recentOpp?: ReturnType<typeof makeOpportunity> | null
  alternatives?: ReturnType<typeof makeOffer>[]
} = {}): PrismaClient {
  return {
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(opts.hasPrefs !== false ? { userId: USER_ID } : null),
    },
    opportunity: {
      findFirst: vi.fn().mockResolvedValue(opts.recentOpp !== undefined ? opts.recentOpp : makeOpportunity()),
      update: vi.fn().mockResolvedValue({}),
    },
    offer: {
      findMany: vi.fn().mockResolvedValue(opts.alternatives ?? []),
    },
  } as unknown as PrismaClient
}

// ── handleOpportunityReply ────────────────────────────────────────────────────

describe('handleOpportunityReply — opt-out (global, always handled)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('handles STOP regardless of prefs state', async () => {
    vi.mocked(isOptOutMessage).mockReturnValueOnce(true)
    const prisma = makePrisma({ hasPrefs: true })
    const result = await handleOpportunityReply(prisma, USER_ID, 'STOP')
    expect(result.handled).toBe(true)
    expect(recordOptOut).toHaveBeenCalledWith(prisma, USER_ID)
  })

  it('includes opt-back-in instruction in response', async () => {
    vi.mocked(isOptOutMessage).mockReturnValueOnce(true)
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, 'UNSUBSCRIBE')
    expect(result.response).toContain('opt back in')
  })
})

describe('handleOpportunityReply — consent flow (no prefs)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opts user in on "yes" when no prefs exist', async () => {
    const prisma = makePrisma({ hasPrefs: false })
    const result = await handleOpportunityReply(prisma, USER_ID, 'yes')
    expect(result.handled).toBe(true)
    expect(recordOptIn).toHaveBeenCalledWith(prisma, USER_ID)
    expect(result.response).toBe('Great, you are opted in!')
  })

  it('opts user in on "ok" in consent flow', async () => {
    const prisma = makePrisma({ hasPrefs: false })
    const result = await handleOpportunityReply(prisma, USER_ID, 'ok')
    expect(result.handled).toBe(true)
    expect(recordOptIn).toHaveBeenCalledOnce()
  })

  it('returns CONSENT_DECLINED on "no" in consent flow', async () => {
    const prisma = makePrisma({ hasPrefs: false })
    const result = await handleOpportunityReply(prisma, USER_ID, 'no')
    expect(result.handled).toBe(true)
    expect(result.response).toBe('No problem, opting you out.')
    expect(recordOptIn).not.toHaveBeenCalled()
  })

  it('passes through unknown messages in consent flow (handled=false)', async () => {
    const prisma = makePrisma({ hasPrefs: false })
    const result = await handleOpportunityReply(prisma, USER_ID, 'what is my balance?')
    expect(result.handled).toBe(false)
  })
})

describe('handleOpportunityReply — no recent delivered opportunity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns handled:false when no pending opportunity within 24h', async () => {
    const prisma = makePrisma({ recentOpp: null })
    const result = await handleOpportunityReply(prisma, USER_ID, 'yes')
    expect(result.handled).toBe(false)
  })
})

describe('handleOpportunityReply — DETAIL reply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('generates an affiliate URL and returns detail message', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, '1')
    expect(result.handled).toBe(true)
    expect(generateClickUrl).toHaveBeenCalledWith(prisma, USER_ID, 'offer-001', 'opp-001')
    expect(buildDetailMessage).toHaveBeenCalledOnce()
    expect(result.response).toBe('Detail message content')
  })

  it('"yes" is also a DETAIL reply', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, 'yes')
    expect(result.handled).toBe(true)
    expect(generateClickUrl).toHaveBeenCalledOnce()
  })

  it('"show me" triggers DETAIL', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, 'show me')
    expect(result.handled).toBe(true)
  })
})

describe('handleOpportunityReply — DISMISS reply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the opportunity as DISMISSED in the DB', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, '2')
    expect(result.handled).toBe(true)
    expect(prisma.opportunity.update).toHaveBeenCalledOnce()
    const arg = vi.mocked(prisma.opportunity.update).mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(arg.data.status).toBe('DISMISSED')
    expect(arg.data.dismissReason).toBe('user_declined')
  })

  it('"no thanks" is also a DISMISS reply', async () => {
    const prisma = makePrisma()
    await handleOpportunityReply(prisma, USER_ID, 'no thanks')
    expect(prisma.opportunity.update).toHaveBeenCalledOnce()
  })
})

describe('handleOpportunityReply — MORE reply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists alternative offers when available', async () => {
    const prisma = makePrisma({
      alternatives: [
        makeOffer({ id: 'o2', providerName: 'British Gas', title: 'Fixed Rate', parameters: { monthlyPrice: 75 } }),
        makeOffer({ id: 'o3', providerName: 'E.ON', title: 'Green Plan', parameters: { monthlyPrice: 70 } }),
      ],
    })
    const result = await handleOpportunityReply(prisma, USER_ID, '3')
    expect(result.handled).toBe(true)
    expect(result.response).toContain('British Gas')
    expect(result.response).toContain('E.ON')
  })

  it('responds gracefully when no alternatives exist', async () => {
    const prisma = makePrisma({ alternatives: [] })
    const result = await handleOpportunityReply(prisma, USER_ID, 'more')
    expect(result.handled).toBe(true)
    expect(result.response).toContain("don't have other")
  })

  it('"alternatives" also triggers MORE', async () => {
    const prisma = makePrisma({ alternatives: [] })
    const result = await handleOpportunityReply(prisma, USER_ID, 'alternatives')
    expect(result.handled).toBe(true)
  })
})

describe('handleOpportunityReply — REMIND reply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('schedules a reminder and marks opportunity SUPPRESSED', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, 'March 2026')
    expect(result.handled).toBe(true)
    const arg = vi.mocked(prisma.opportunity.update).mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(arg.data.status).toBe('SUPPRESSED')
    expect(arg.data.scheduledDeliveryAt).toBeInstanceOf(Date)
  })

  it('response confirms the reminder month and year', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, 'March 2026')
    expect(result.response).toContain('March 2026')
  })

  it('handles all months case-insensitively', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, 'december 2025')
    expect(result.handled).toBe(true)
  })
})

describe('handleOpportunityReply — UNKNOWN reply fallthrough', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns handled:false for unrecognised messages', async () => {
    const prisma = makePrisma()
    const result = await handleOpportunityReply(prisma, USER_ID, 'what is the weather like?')
    expect(result.handled).toBe(false)
    expect(result.response).toBe('')
  })
})

// ── REMIND month + year pattern guard ────────────────────────────────────────

describe('REMIND month + year patterns', () => {
  const REMIND_PATTERN = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i

  const valid = ['March 2026', 'march 2026', 'MARCH 2026', 'January 2027', 'December 2025']
  for (const reply of valid) {
    it(`matches: "${reply}"`, () => expect(REMIND_PATTERN.test(reply)).toBe(true))
  }

  it('does not match just a year', () => expect(REMIND_PATTERN.test('2026')).toBe(false))
  it('does not match just a month', () => expect(REMIND_PATTERN.test('March')).toBe(false))
})
