import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { getSavingsRecommendations, isSavingsRecommendationRequest } from '../savingsRecommendationService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const SAMPLE_OFFER = {
  id: 'offer-1',
  providerName: 'Chase',
  providerSlug: 'chase',
  title: 'Easy Access Saver',
  shortDescription: '4.1% AER easy access savings account',
  parameters: { aer: 4.1, accessType: 'easy', minDeposit: 1 },
  affiliateBaseUrl: 'https://example.com/chase',
  isActive: true,
  category: { slug: 'savings', name: 'Savings' },
}

function makePrisma(opts: {
  hasConnection?: boolean
  accounts?: Array<{ currentBalance: Decimal; accountType: string }>
  offers?: typeof SAMPLE_OFFER[]
} = {}): PrismaClient {
  const { hasConnection = true, accounts = [], offers = [] } = opts
  return {
    bankConnection: {
      findFirst: vi.fn().mockResolvedValue(hasConnection ? { id: 'conn-1' } : null),
    },
    account: {
      findMany: vi.fn().mockResolvedValue(accounts),
    },
    offer: {
      findMany: vi.fn().mockResolvedValue(offers),
    },
  } as unknown as PrismaClient
}

describe('getSavingsRecommendations', () => {
  it('returns connect-bank prompt when user has no active connection', async () => {
    const prisma = makePrisma({ hasConnection: false })
    const result = await getSavingsRecommendations(prisma, 'user-1')
    expect(result).toMatch(/connect|bank/i)
    expect(prisma.offer.findMany).not.toHaveBeenCalled()
  })

  it('returns generic savings tip when no offers exist in DB', async () => {
    const prisma = makePrisma({
      accounts: [{ currentBalance: new Decimal(5000), accountType: 'CURRENT' }],
      offers: [],
    })
    const result = await getSavingsRecommendations(prisma, 'user-1')
    expect(result).toMatch(/MoneySavingExpert|no.*offer|tip/i)
  })

  it('returns formatted message with top offer when offers exist', async () => {
    const prisma = makePrisma({
      accounts: [{ currentBalance: new Decimal(8000), accountType: 'CURRENT' }],
      offers: [SAMPLE_OFFER],
    })
    const result = await getSavingsRecommendations(prisma, 'user-1')
    expect(result).toMatch(/Chase/i)
    expect(result).toMatch(/Easy Access Saver/i)
  })

  it('result contains idle balance figure', async () => {
    const prisma = makePrisma({
      accounts: [{ currentBalance: new Decimal(3500), accountType: 'CURRENT' }],
      offers: [SAMPLE_OFFER],
    })
    const result = await getSavingsRecommendations(prisma, 'user-1')
    expect(result).toMatch(/3,500/)
  })

  it('result contains affiliate disclosure', async () => {
    const prisma = makePrisma({
      accounts: [{ currentBalance: new Decimal(2000), accountType: 'CURRENT' }],
      offers: [SAMPLE_OFFER],
    })
    const result = await getSavingsRecommendations(prisma, 'user-1')
    expect(result).toMatch(/commission/i)
  })
})

describe('isSavingsRecommendationRequest', () => {
  it('matches recommendation phrases', () => {
    expect(isSavingsRecommendationRequest('recommend a savings account')).toBe(true)
    expect(isSavingsRecommendationRequest('where should I put my savings?')).toBe(true)
    expect(isSavingsRecommendationRequest('best savings account right now')).toBe(true)
    expect(isSavingsRecommendationRequest('which savings should I get?')).toBe(true)
  })

  it('does not match general savings queries', () => {
    expect(isSavingsRecommendationRequest('how much am I saving?')).toBe(false)
    expect(isSavingsRecommendationRequest('my savings rate')).toBe(false)
  })
})
