/**
 * opportunityDeliveryService tests.
 *
 * Covers the compliance gate, minimum-spacing guard, opportunity ranking,
 * freeform and template send paths, DB mark-delivered transaction, and the
 * batch runner's per-user error isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

// ── Mocks (must be defined before the static import of the module under test) ─

vi.mock('../../compliance/consentService.js', () => ({
  checkDeliveryEligibility: vi.fn(),
}))

vi.mock('../opportunityScorer.js', () => ({
  scoreOpportunity: vi.fn((opp: { id: string; offerId: string }) => ({
    id: opp.id,
    offerId: opp.offerId,
    score: 0.8,
  })),
  rankByCategory: vi.fn((scored: unknown[]) => scored),
}))

vi.mock('../opportunityMessageBuilder.js', () => ({
  buildOutreachMessage: vi.fn().mockReturnValue({ body: 'Save money with Octopus Energy! https://short.url/abc' }),
}))

vi.mock('../engagementHistoryService.js', () => ({
  loadEngagementHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../affiliate/clickTrackingService.js', () => ({
  generateClickUrl: vi.fn().mockResolvedValue('https://short.url/abc'),
}))

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid.outbound1' }),
  sendTemplateMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid.template1' }),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('447700900001')),
}))

vi.mock('../../../config.js', () => ({
  config: {
    ENCRYPTION_KEY: 'a'.repeat(64),
    WHATSAPP_PHONE_NUMBER_ID: 'waba-123',
    WHATSAPP_ACCESS_TOKEN: 'token-abc',
    WHATSAPP_OPPORTUNITY_TEMPLATE_NAME: '',
    WHATSAPP_OPPORTUNITY_TEMPLATE_LANG: 'en_GB',
  },
}))

import { deliverOpportunitiesToUser, runDeliveryBatch } from '../opportunityDeliveryService.js'
import { checkDeliveryEligibility } from '../../compliance/consentService.js'
import { sendWhatsAppMessage, sendTemplateMessage } from '../../whatsapp/sender.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-00000001'
const OPP_ID = 'opp-00000001'
const OFFER_ID = 'offer-0000001'

const SAMPLE_OPPORTUNITY = {
  id: OPP_ID,
  offerId: OFFER_ID,
  userId: USER_ID,
  status: 'PENDING',
  annualSavingEstimate: 240,
  savingConfidence: 0.8,
  createdAt: new Date(),
  expiresAt: null,
  deliveredAt: null,
  waMessageId: null,
  recurringPayment: null,
  offer: {
    id: OFFER_ID,
    title: 'Switch to Octopus Energy',
    providerName: 'Octopus Energy',
    shortDescription: 'Save on your energy bill',
    keyBenefits: ['No exit fees', 'Fixed rate'],
    parameters: {},
    fcaDisclaimer: null,
    category: { slug: 'energy', name: 'Energy' },
  },
}

const PREFS_WITH_TIMESTAMP = {
  lastMessageSentAt: new Date(Date.now() - 49 * 3_600_000), // 49 hours ago — outside MIN_SPACING
}

const PREFS_RECENT = {
  lastMessageSentAt: new Date(Date.now() - 1 * 3_600_000), // 1 hour ago — within MIN_SPACING
}

function makePrisma(opts: {
  phone?: string | null
  prefs?: Record<string, unknown> | null
  opportunities?: typeof SAMPLE_OPPORTUNITY[]
  txResult?: unknown[]
} = {}): PrismaClient {
  const phone = opts.phone === undefined ? 'encrypted-phone' : opts.phone
  const prefs = opts.prefs === undefined ? PREFS_WITH_TIMESTAMP : opts.prefs
  const opps = opts.opportunities ?? [SAMPLE_OPPORTUNITY]

  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(
        phone !== null ? { whatsappPhoneEnc: Buffer.from('enc') } : null,
      ),
    },
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(prefs),
      update: vi.fn().mockResolvedValue({}),
    },
    opportunity: {
      findMany: vi.fn().mockResolvedValue(opps),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn().mockResolvedValue(opts.txResult ?? [{}, {}]),
  } as unknown as PrismaClient
}

// ── deliverOpportunitiesToUser ─────────────────────────────────────────────────

describe('deliverOpportunitiesToUser', () => {
  beforeEach(() => {
    vi.mocked(checkDeliveryEligibility).mockResolvedValue({ eligible: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns skipped with reason when compliance gate blocks', async () => {
    vi.mocked(checkDeliveryEligibility).mockResolvedValue({ eligible: false, reason: 'NO_CONSENT' })

    const prisma = makePrisma()
    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(result).toEqual({ delivered: 0, skipped: 1, reason: 'NO_CONSENT' })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns MIN_SPACING when last message was sent less than 48h ago', async () => {
    const prisma = makePrisma({ prefs: PREFS_RECENT })
    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(result).toEqual({ delivered: 0, skipped: 1, reason: 'MIN_SPACING' })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns empty result when there are no pending opportunities', async () => {
    const prisma = makePrisma({ opportunities: [] })
    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(result).toEqual({ delivered: 0, skipped: 0 })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns NO_PHONE when user has no encrypted phone', async () => {
    const prisma = makePrisma({ phone: null })
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(result).toEqual({ delivered: 0, skipped: 1, reason: 'NO_PHONE' })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns skipped when category-level eligibility blocks', async () => {
    vi.mocked(checkDeliveryEligibility)
      .mockResolvedValueOnce({ eligible: true })           // global check passes
      .mockResolvedValueOnce({ eligible: false, reason: 'CATEGORY_DISABLED' }) // category check fails

    const prisma = makePrisma()
    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(result).toEqual({ delivered: 0, skipped: 1, reason: 'CATEGORY_DISABLED' })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('sends freeform message and returns delivered:1 (no template configured)', async () => {
    const prisma = makePrisma()
    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(result).toEqual({ delivered: 1, skipped: 0 })
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('marks the opportunity DELIVERED in a transaction', async () => {
    const prisma = makePrisma()
    await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    const txCalls = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown[]
    // Two operations passed as array to $transaction
    expect(txCalls).toHaveLength(2)
  })

  it('sends via sendTemplateMessage when template name is configured', async () => {
    // Override config mock for this test only
    const { config } = await import('../../../config.js')
    const original = config.WHATSAPP_OPPORTUNITY_TEMPLATE_NAME
    ;(config as Record<string, unknown>).WHATSAPP_OPPORTUNITY_TEMPLATE_NAME = 'monika_opportunity_v1'

    const prisma = makePrisma()
    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    expect(result.delivered).toBe(1)
    expect(sendTemplateMessage).toHaveBeenCalledOnce()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()

    ;(config as Record<string, unknown>).WHATSAPP_OPPORTUNITY_TEMPLATE_NAME = original
  })

  it('does not send when prefs.lastMessageSentAt is null (first-ever message allowed)', async () => {
    const prisma = makePrisma({ prefs: { lastMessageSentAt: null } })
    const result = await deliverOpportunitiesToUser(prisma, USER_ID)

    // Should deliver — no spacing restriction when never sent before
    expect(result.delivered).toBe(1)
  })
})

// ── runDeliveryBatch ───────────────────────────────────────────────────────────

describe('runDeliveryBatch', () => {
  afterEach(() => vi.clearAllMocks())

  it('processes each user and aggregates delivered count', async () => {
    vi.mocked(checkDeliveryEligibility).mockResolvedValue({ eligible: true })

    const prisma = {
      opportunity: {
        findMany: vi.fn()
          // batch query: distinct users with pending opps
          .mockResolvedValueOnce([{ userId: 'user-A' }, { userId: 'user-B' }])
          // per-user pending opps for user-A
          .mockResolvedValueOnce([SAMPLE_OPPORTUNITY])
          // per-user pending opps for user-B
          .mockResolvedValueOnce([{ ...SAMPLE_OPPORTUNITY, id: 'opp-B', userId: 'user-B' }]),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: Buffer.from('enc') }),
      },
      userOpportunityPreferences: {
        findUnique: vi.fn().mockResolvedValue(PREFS_WITH_TIMESTAMP),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockResolvedValue([{}, {}]),
    } as unknown as PrismaClient

    const logger = { info: vi.fn(), error: vi.fn() }
    const result = await runDeliveryBatch(prisma, logger)

    expect(result.processed).toBe(2)
    expect(result.delivered).toBe(2)
    expect(result.errors).toBe(0)
    expect(logger.info).toHaveBeenCalledOnce()
  })

  it('isolates errors per user — one failure does not block others', async () => {
    vi.mocked(checkDeliveryEligibility).mockResolvedValue({ eligible: true })

    const prisma = {
      opportunity: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ userId: 'user-A' }, { userId: 'user-B' }])
          // user-A throws
          .mockRejectedValueOnce(new Error('DB timeout'))
          // user-B succeeds
          .mockResolvedValueOnce([SAMPLE_OPPORTUNITY]),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: Buffer.from('enc') }),
      },
      userOpportunityPreferences: {
        findUnique: vi.fn().mockResolvedValue(PREFS_WITH_TIMESTAMP),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockResolvedValue([{}, {}]),
    } as unknown as PrismaClient

    const logger = { info: vi.fn(), error: vi.fn() }
    const result = await runDeliveryBatch(prisma, logger)

    expect(result.processed).toBe(2)
    expect(result.errors).toBe(1)
    expect(result.delivered).toBe(1)
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('returns zero counts when there are no pending opportunities', async () => {
    const prisma = {
      opportunity: {
        findMany: vi.fn().mockResolvedValueOnce([]),
      },
    } as unknown as PrismaClient

    const logger = { info: vi.fn(), error: vi.fn() }
    const result = await runDeliveryBatch(prisma, logger)

    expect(result).toEqual({ processed: 0, delivered: 0, errors: 0 })
  })
})
