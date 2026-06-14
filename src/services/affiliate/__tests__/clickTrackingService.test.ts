/**
 * Affiliate click tracking tests.
 *
 * Covers short URL generation, network URL construction per affiliate network,
 * click-record creation, redirect recording, fraud detection, and postback
 * commission updates. Revenue accuracy depends on this code — do not weaken.
 */
import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../../config.js', () => ({
  config: {
    APP_BASE_URL: 'https://monika.app',
    AWIN_PUBLISHER_ID: '123456',
    CJ_PUBLISHER_ID: '789012',
  },
}))

import {
  generateClickUrl,
  recordRedirect,
  recordPostback,
  checkForFraud,
} from '../clickTrackingService.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const USER_ID = 'user-00000001'
const OFFER_ID = 'offer-0000001'
const OPP_ID = 'opp-00000001'

function makeOffer(network: string, overrides: Record<string, unknown> = {}) {
  return {
    id: OFFER_ID,
    affiliateNetwork: network,
    affiliateProgramId: 'prog-001',
    affiliateBaseUrl: 'https://provider.com/signup',
    ...overrides,
  }
}

function makePrisma(opts: {
  offer?: ReturnType<typeof makeOffer>
  existingClick?: Record<string, unknown> | null
  clickCount?: number
} = {}): PrismaClient {
  const offer = opts.offer ?? makeOffer('direct')
  return {
    offer: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(offer),
    },
    affiliateClick: {
      create: vi.fn().mockResolvedValue({ id: 'click-1', shortCode: 'abc12345' }),
      findUnique: vi.fn().mockResolvedValue(opts.existingClick ?? null),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(opts.clickCount ?? 0),
    },
    opportunity: {
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

// ── generateClickUrl ───────────────────────────────────────────────────────────

describe('generateClickUrl', () => {
  it('returns a short URL with APP_BASE_URL prefix', async () => {
    const prisma = makePrisma()
    const url = await generateClickUrl(prisma, USER_ID, OFFER_ID)
    expect(url).toMatch(/^https:\/\/monika\.app\/r\/[0-9a-zA-Z]{8}$/)
  })

  it('creates an affiliateClick record in the DB', async () => {
    const prisma = makePrisma()
    await generateClickUrl(prisma, USER_ID, OFFER_ID, OPP_ID)

    expect(prisma.affiliateClick.create).toHaveBeenCalledOnce()
    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.userId).toBe(USER_ID)
    expect(data.offerId).toBe(OFFER_ID)
    expect(data.opportunityId).toBe(OPP_ID)
    expect(data.commissionStatus).toBe('PENDING')
  })

  it('click ref embeds userId and offerId', async () => {
    const prisma = makePrisma()
    await generateClickUrl(prisma, USER_ID, OFFER_ID)

    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    const clickRef = data.clickRef as string
    expect(clickRef).toContain(USER_ID)
    expect(clickRef).toContain(OFFER_ID)
  })

  it('generates a different short code on every call (random)', async () => {
    const prisma = makePrisma()
    const url1 = await generateClickUrl(prisma, USER_ID, OFFER_ID)
    const url2 = await generateClickUrl(prisma, USER_ID, OFFER_ID)
    expect(url1).not.toBe(url2)
  })

  it('builds AWIN network URL with publisher and clickref params', async () => {
    const prisma = makePrisma({ offer: makeOffer('awin') })
    await generateClickUrl(prisma, USER_ID, OFFER_ID)

    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    const redirectUrl = data.redirectedToUrl as string
    expect(redirectUrl).toContain('awin1.com')
    expect(redirectUrl).toContain('awinmid=prog-001')
    expect(redirectUrl).toContain('awinaffid=123456')
    expect(redirectUrl).toContain('clickref=')
  })

  it('builds CJ network URL with publisher and SID params', async () => {
    const prisma = makePrisma({ offer: makeOffer('cj') })
    await generateClickUrl(prisma, USER_ID, OFFER_ID)

    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    const redirectUrl = data.redirectedToUrl as string
    expect(redirectUrl).toContain('anrdoezrs.net')
    expect(redirectUrl).toContain('789012')
    expect(redirectUrl).toContain('sid=')
  })

  it('builds Impact URL with subId1 param', async () => {
    const prisma = makePrisma({ offer: makeOffer('impact') })
    await generateClickUrl(prisma, USER_ID, OFFER_ID)

    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.redirectedToUrl as string).toContain('subId1=')
  })

  it('builds direct URL with ref query param', async () => {
    const prisma = makePrisma({ offer: makeOffer('direct') })
    await generateClickUrl(prisma, USER_ID, OFFER_ID)

    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    const redirectUrl = data.redirectedToUrl as string
    expect(redirectUrl).toContain('https://provider.com/signup')
    expect(redirectUrl).toContain('ref=')
  })

  it('falls back to base URL for unknown network', async () => {
    const prisma = makePrisma({ offer: makeOffer('unknown_network') })
    await generateClickUrl(prisma, USER_ID, OFFER_ID)

    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.redirectedToUrl).toBe('https://provider.com/signup')
  })

  it('stores opportunityId as null when not provided', async () => {
    const prisma = makePrisma()
    await generateClickUrl(prisma, USER_ID, OFFER_ID)

    const data = (vi.mocked(prisma.affiliateClick.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.opportunityId).toBeNull()
  })
})

// ── checkForFraud ──────────────────────────────────────────────────────────────

describe('checkForFraud', () => {
  it('returns isSuspicious:false when click count is below threshold', async () => {
    const prisma = makePrisma({ clickCount: 2 })
    const result = await checkForFraud(prisma, USER_ID, OFFER_ID, '1.2.3.4')
    expect(result.isSuspicious).toBe(false)
  })

  it('returns isSuspicious:true with REPEATED_CLICK flag at 3+ clicks', async () => {
    const prisma = makePrisma({ clickCount: 3 })
    const result = await checkForFraud(prisma, USER_ID, OFFER_ID, '1.2.3.4')
    expect(result.isSuspicious).toBe(true)
    if (result.isSuspicious) {
      expect(result.flags).toContain('REPEATED_CLICK')
    }
  })
})

// ── recordRedirect ─────────────────────────────────────────────────────────────

describe('recordRedirect', () => {
  it('returns null when short code is not found', async () => {
    const prisma = makePrisma({ existingClick: null })
    const result = await recordRedirect(prisma, 'notfound', '1.2.3.4', 'Mozilla/5')
    expect(result).toBeNull()
  })

  it('returns redirectUrl and opportunityId on a valid click', async () => {
    const click = {
      id: 'click-1',
      userId: USER_ID,
      offerId: OFFER_ID,
      opportunityId: OPP_ID,
      redirectedToUrl: 'https://provider.com/signup?ref=abc',
      offer: makeOffer('direct'),
    }
    const prisma = makePrisma({ existingClick: click, clickCount: 0 })
    const result = await recordRedirect(prisma, 'abc12345', '1.2.3.4', 'Mozilla/5')

    expect(result).not.toBeNull()
    expect(result!.redirectUrl).toBe('https://provider.com/signup?ref=abc')
    expect(result!.opportunityId).toBe(OPP_ID)
  })

  it('updates the click record with redirectedAt timestamp', async () => {
    const click = {
      id: 'click-1',
      userId: USER_ID,
      offerId: OFFER_ID,
      opportunityId: null,
      redirectedToUrl: 'https://provider.com',
      offer: makeOffer('direct'),
    }
    const prisma = makePrisma({ existingClick: click, clickCount: 0 })
    await recordRedirect(prisma, 'abc12345', '1.2.3.4', 'Mozilla/5')

    expect(prisma.affiliateClick.update).toHaveBeenCalledOnce()
    const updateData = (vi.mocked(prisma.affiliateClick.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(updateData.redirectedAt).toBeInstanceOf(Date)
  })

  it('marks click as suspicious when fraud detected', async () => {
    const click = {
      id: 'click-1',
      userId: USER_ID,
      offerId: OFFER_ID,
      opportunityId: null,
      redirectedToUrl: 'https://provider.com',
      offer: makeOffer('direct'),
    }
    const prisma = makePrisma({ existingClick: click, clickCount: 5 }) // triggers fraud
    await recordRedirect(prisma, 'abc12345', '1.2.3.4', 'Mozilla/5')

    const updateData = (vi.mocked(prisma.affiliateClick.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(updateData.isSuspicious).toBe(true)
    expect(updateData.fraudFlags).toContain('REPEATED_CLICK')
  })

  it('updates opportunity status to CLICKED when opportunityId is set', async () => {
    const click = {
      id: 'click-1',
      userId: USER_ID,
      offerId: OFFER_ID,
      opportunityId: OPP_ID,
      redirectedToUrl: 'https://provider.com',
      offer: makeOffer('direct'),
    }
    const prisma = makePrisma({ existingClick: click, clickCount: 0 })
    await recordRedirect(prisma, 'abc12345', '1.2.3.4', 'Mozilla/5')

    expect(prisma.opportunity.update).toHaveBeenCalledOnce()
    const oppUpdate = vi.mocked(prisma.opportunity.update).mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(oppUpdate.data.status).toBe('CLICKED')
    expect(oppUpdate.data.clickedAt).toBeInstanceOf(Date)
  })

  it('does NOT update opportunity when opportunityId is null', async () => {
    const click = {
      id: 'click-1',
      userId: USER_ID,
      offerId: OFFER_ID,
      opportunityId: null,
      redirectedToUrl: 'https://provider.com',
      offer: makeOffer('direct'),
    }
    const prisma = makePrisma({ existingClick: click, clickCount: 0 })
    await recordRedirect(prisma, 'abc12345', '1.2.3.4', 'Mozilla/5')

    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })
})

// ── recordPostback ─────────────────────────────────────────────────────────────

describe('recordPostback', () => {
  it('returns early without DB writes when clickRef not found', async () => {
    const prisma = makePrisma({ existingClick: null })
    ;(prisma.affiliateClick.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await recordPostback(prisma, 'MONIKA_bad_ref', 'txn-1', 50, 'approved', {})

    expect(prisma.affiliateClick.update).not.toHaveBeenCalled()
  })

  it('updates click with APPROVED status and commission amount', async () => {
    const click = { id: 'click-1', opportunityId: null }
    const prisma = makePrisma()
    ;(prisma.affiliateClick.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(click)

    await recordPostback(prisma, 'MONIKA_ref', 'txn-123', 25.50, 'approved', { raw: true })

    const updateData = (vi.mocked(prisma.affiliateClick.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(updateData.commissionStatus).toBe('APPROVED')
    expect(updateData.commissionAmount).toBe(25.50)
    expect(updateData.transactionId).toBe('txn-123')
    expect(updateData.postbackReceivedAt).toBeInstanceOf(Date)
  })

  it('maps "rejected" status to REJECTED commission status', async () => {
    const click = { id: 'click-1', opportunityId: null }
    const prisma = makePrisma()
    ;(prisma.affiliateClick.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(click)

    await recordPostback(prisma, 'MONIKA_ref', 'txn-456', 0, 'rejected', {})

    const updateData = (vi.mocked(prisma.affiliateClick.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(updateData.commissionStatus).toBe('REJECTED')
  })

  it('maps "pending" status to VALIDATED commission status', async () => {
    const click = { id: 'click-1', opportunityId: null }
    const prisma = makePrisma()
    ;(prisma.affiliateClick.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(click)

    await recordPostback(prisma, 'MONIKA_ref', 'txn-789', 10, 'pending', {})

    const updateData = (vi.mocked(prisma.affiliateClick.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(updateData.commissionStatus).toBe('VALIDATED')
  })

  it('marks opportunity CONVERTED when status is approved and opportunityId is set', async () => {
    const click = { id: 'click-1', opportunityId: OPP_ID }
    const prisma = makePrisma()
    ;(prisma.affiliateClick.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(click)

    await recordPostback(prisma, 'MONIKA_ref', 'txn-conv', 30, 'approved', {})

    expect(prisma.opportunity.update).toHaveBeenCalledOnce()
    const oppUpdate = vi.mocked(prisma.opportunity.update).mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(oppUpdate.data.status).toBe('CONVERTED')
    expect(oppUpdate.data.convertedAt).toBeInstanceOf(Date)
  })

  it('does NOT update opportunity on rejected postback', async () => {
    const click = { id: 'click-1', opportunityId: OPP_ID }
    const prisma = makePrisma()
    ;(prisma.affiliateClick.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(click)

    await recordPostback(prisma, 'MONIKA_ref', 'txn-rej', 0, 'rejected', {})

    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })
})
