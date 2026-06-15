import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import {
  checkSwitchingOpportunity,
  isSwitchingRequest,
  extractSwitchingCategory,
} from '../switchingDetectorService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const BROADBAND_OFFER = {
  id: 'offer-bb-1',
  providerName: 'Plusnet',
  title: 'Unlimited Fibre 36',
  shortDescription: 'Fast fibre at £24.99/month',
  parameters: { monthlyPrice: 24.99 },
  affiliateBaseUrl: 'https://example.com/plusnet',
  isActive: true,
  category: { slug: 'broadband' },
}

function makePrisma(opts: {
  recurring?: Array<{ merchantName: string; typicalAmount: Decimal; frequency: string }>
  offers?: typeof BROADBAND_OFFER[]
} = {}): PrismaClient {
  const { recurring = [], offers = [] } = opts
  return {
    recurringPayment: { findMany: vi.fn().mockResolvedValue(recurring) },
    offer: { findMany: vi.fn().mockResolvedValue(offers) },
  } as unknown as PrismaClient
}

describe('checkSwitchingOpportunity', () => {
  it('returns no-payment message when user has no broadband/mobile recurring payments', async () => {
    const prisma = makePrisma({ recurring: [] })
    const result = await checkSwitchingOpportunity(prisma, 'user-1')
    expect(result).toMatch(/couldn.*t find|not found/i)
  })

  it('surfaces cheaper offer when user is overpaying', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'BT Broadband', typicalAmount: new Decimal(45), frequency: 'monthly' }],
      offers: [BROADBAND_OFFER],
    })
    const result = await checkSwitchingOpportunity(prisma, 'user-1', 'broadband')
    expect(result).toMatch(/Plusnet/)
    expect(result).toMatch(/saving/i)
    expect(result).toMatch(/24\.99/)
  })

  it('says no cheaper offers when user is already on best price', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'BT Broadband', typicalAmount: new Decimal(20), frequency: 'monthly' }],
      offers: [BROADBAND_OFFER], // £24.99 is more expensive than £20
    })
    const result = await checkSwitchingOpportunity(prisma, 'user-1', 'broadband')
    expect(result).toMatch(/no cheaper|uSwitch|competitive/i)
  })

  it('includes affiliate disclosure when saving found', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'Virgin Media', typicalAmount: new Decimal(55), frequency: 'monthly' }],
      offers: [BROADBAND_OFFER],
    })
    const result = await checkSwitchingOpportunity(prisma, 'user-1', 'broadband')
    expect(result).toMatch(/commission/i)
  })
})

describe('isSwitchingRequest', () => {
  it('matches switching intent queries', () => {
    expect(isSwitchingRequest('should I switch broadband provider?')).toBe(true)
    expect(isSwitchingRequest('am I paying too much for broadband?')).toBe(true)
    expect(isSwitchingRequest('cheaper mobile plan?')).toBe(true)
    expect(isSwitchingRequest('best deal on broadband?')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isSwitchingRequest('how much did I spend last month?')).toBe(false)
    expect(isSwitchingRequest('what is my balance?')).toBe(false)
  })
})

describe('extractSwitchingCategory', () => {
  it('detects broadband', () => {
    expect(extractSwitchingCategory('change my broadband')).toBe('broadband')
    expect(extractSwitchingCategory('cheaper fibre internet')).toBe('broadband')
  })
  it('detects mobile', () => {
    expect(extractSwitchingCategory('cheaper sim plan')).toBe('mobile')
    expect(extractSwitchingCategory('change mobile provider')).toBe('mobile')
  })
  it('returns undefined for ambiguous', () => {
    expect(extractSwitchingCategory('should I switch?')).toBeUndefined()
  })
})
