/**
 * Offer upsert service tests.
 *
 * The match key is (providerSlug, categoryId, affiliateProgramId).
 * On hit: update mutable fields only. On miss: create. Never overwrite
 * curated content (title, keyBenefits, keyTerms, etc.) on update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { upsertOffer, expireStaleOffers, type OfferInput } from '../offerUpsertService.js'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const CATEGORY = { id: 'cat-energy', slug: 'energy', name: 'Energy' }

const BASE_INPUT: OfferInput = {
  providerName: 'Octopus Energy',
  providerSlug: 'octopus-energy',
  categorySlug: 'energy',
  title: 'Octopus Flexible Tariff',
  shortDescription: 'Save on energy with Octopus',
  affiliateNetwork: 'awin',
  affiliateProgramId: 'prog-001',
  affiliateBaseUrl: 'https://octopus.energy/join',
  commissionType: 'revenue_share',
  commissionValue: 5,
  parameters: { estimatedAnnualSaving: 240 },
}

function makePrisma(opts: {
  category?: typeof CATEGORY | null
  existingOffer?: Record<string, unknown> | null
  createdOffer?: Record<string, unknown>
} = {}): PrismaClient {
  const category = opts.category === undefined ? CATEGORY : opts.category
  const existing = opts.existingOffer === undefined ? null : opts.existingOffer
  const created = opts.createdOffer ?? { id: 'offer-new-001' }

  return {
    offerCategory: {
      findUnique: vi.fn().mockResolvedValue(category),
    },
    offer: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(created),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
  } as unknown as PrismaClient
}

// ── upsertOffer — create path ──────────────────────────────────────────────────

describe('upsertOffer — create (no existing offer)', () => {
  it('returns action:created and the new offer id', async () => {
    const prisma = makePrisma({ createdOffer: { id: 'offer-001' } })
    const result = await upsertOffer(prisma, BASE_INPUT)

    expect(result.action).toBe('created')
    expect(result.id).toBe('offer-001')
  })

  it('calls prisma.offer.create with correct fields', async () => {
    const prisma = makePrisma()
    await upsertOffer(prisma, BASE_INPUT)

    expect(prisma.offer.create).toHaveBeenCalledOnce()
    const data = (vi.mocked(prisma.offer.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.providerSlug).toBe('octopus-energy')
    expect(data.categoryId).toBe('cat-energy')
    expect(data.affiliateProgramId).toBe('prog-001')
    expect(data.isActive).toBe(true)
  })

  it('defaults commissionCurrency to GBP when not provided', async () => {
    const prisma = makePrisma()
    await upsertOffer(prisma, BASE_INPUT)

    const data = (vi.mocked(prisma.offer.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.commissionCurrency).toBe('GBP')
  })

  it('defaults cookieDurationDays to 30 when not provided', async () => {
    const prisma = makePrisma()
    await upsertOffer(prisma, BASE_INPUT)

    const data = (vi.mocked(prisma.offer.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.cookieDurationDays).toBe(30)
  })

  it('defaults keyBenefits and keyTerms to empty arrays', async () => {
    const prisma = makePrisma()
    await upsertOffer(prisma, { ...BASE_INPUT })

    const data = (vi.mocked(prisma.offer.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.keyBenefits).toEqual([])
    expect(data.keyTerms).toEqual([])
  })

  it('stores provided keyBenefits when given', async () => {
    const prisma = makePrisma()
    await upsertOffer(prisma, { ...BASE_INPUT, keyBenefits: ['No exit fees', 'Fixed rate'] })

    const data = (vi.mocked(prisma.offer.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.keyBenefits).toEqual(['No exit fees', 'Fixed rate'])
  })

  it('sets requiresBankLink to false by default', async () => {
    const prisma = makePrisma()
    await upsertOffer(prisma, BASE_INPUT)

    const data = (vi.mocked(prisma.offer.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.requiresBankLink).toBe(false)
  })

  it('throws when category slug is not found', async () => {
    const prisma = makePrisma({ category: null })
    await expect(upsertOffer(prisma, BASE_INPUT)).rejects.toThrow('Unknown offer category: energy')
  })
})

// ── upsertOffer — update path ──────────────────────────────────────────────────

describe('upsertOffer — update (existing offer found)', () => {
  const EXISTING = { id: 'offer-existing-001', title: 'Old Title', keyBenefits: ['Old benefit'] }

  it('returns action:updated and the existing offer id', async () => {
    const prisma = makePrisma({ existingOffer: EXISTING })
    const result = await upsertOffer(prisma, BASE_INPUT)

    expect(result.action).toBe('updated')
    expect(result.id).toBe('offer-existing-001')
  })

  it('calls prisma.offer.update (not create) on match', async () => {
    const prisma = makePrisma({ existingOffer: EXISTING })
    await upsertOffer(prisma, BASE_INPUT)

    expect(prisma.offer.update).toHaveBeenCalledOnce()
    expect(prisma.offer.create).not.toHaveBeenCalled()
  })

  it('updates mutable fields: providerName, commissionValue, affiliateBaseUrl', async () => {
    const prisma = makePrisma({ existingOffer: EXISTING })
    await upsertOffer(prisma, {
      ...BASE_INPUT,
      providerName: 'Octopus Energy Ltd',
      commissionValue: 7.5,
      affiliateBaseUrl: 'https://octopus.energy/join/v2',
    })

    const data = (vi.mocked(prisma.offer.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.providerName).toBe('Octopus Energy Ltd')
    expect(data.commissionValue).toBe(7.5)
    expect(data.affiliateBaseUrl).toBe('https://octopus.energy/join/v2')
  })

  it('sets lastRefreshedAt on every update', async () => {
    const prisma = makePrisma({ existingOffer: EXISTING })
    const before = new Date()
    await upsertOffer(prisma, BASE_INPUT)
    const after = new Date()

    const data = (vi.mocked(prisma.offer.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    const refreshedAt = data.lastRefreshedAt as Date
    expect(refreshedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(refreshedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('always sets isActive:true on update (reactivates a previously inactive offer)', async () => {
    const prisma = makePrisma({ existingOffer: { ...EXISTING, isActive: false } })
    await upsertOffer(prisma, BASE_INPUT)

    const data = (vi.mocked(prisma.offer.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.isActive).toBe(true)
  })

  it('does NOT update title, keyBenefits, or keyTerms (curated content protection)', async () => {
    const prisma = makePrisma({ existingOffer: EXISTING })
    await upsertOffer(prisma, { ...BASE_INPUT, title: 'New Title', keyBenefits: ['New benefit'] })

    const data = (vi.mocked(prisma.offer.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.title).toBeUndefined()
    expect(data.keyBenefits).toBeUndefined()
    expect(data.keyTerms).toBeUndefined()
  })

  it('includes providerLogoUrl in update only when explicitly provided', async () => {
    const prisma = makePrisma({ existingOffer: EXISTING })
    await upsertOffer(prisma, { ...BASE_INPUT, providerLogoUrl: 'https://cdn.com/logo.png' })

    const data = (vi.mocked(prisma.offer.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.providerLogoUrl).toBe('https://cdn.com/logo.png')
  })

  it('omits providerLogoUrl from update when not provided (avoids overwrite)', async () => {
    const prisma = makePrisma({ existingOffer: EXISTING })
    await upsertOffer(prisma, BASE_INPUT) // no providerLogoUrl

    const data = (vi.mocked(prisma.offer.update).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect('providerLogoUrl' in data).toBe(false)
  })
})

// ── expireStaleOffers ─────────────────────────────────────────────────────────

describe('expireStaleOffers', () => {
  it('returns the count of deactivated offers', async () => {
    const prisma = makePrisma()
    const count = await expireStaleOffers(prisma)
    expect(count).toBe(3)
  })

  it('calls updateMany with isActive:false and expiresAt lt now', async () => {
    const prisma = makePrisma()
    const before = new Date()
    await expireStaleOffers(prisma)
    const after = new Date()

    expect(prisma.offer.updateMany).toHaveBeenCalledOnce()
    const args = vi.mocked(prisma.offer.updateMany).mock.calls[0]![0] as {
      where: { isActive: boolean; expiresAt: { lt: Date } }
      data: { isActive: boolean }
    }
    expect(args.where.isActive).toBe(true)
    expect(args.where.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(args.where.expiresAt.lt.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(args.data.isActive).toBe(false)
  })
})
