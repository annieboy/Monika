import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { offersListPage } from '../pages/offers.js'

function makePrisma(offers: unknown[] = [], total = 0, categories: unknown[] = []): PrismaClient {
  return {
    offer: {
      findMany: vi.fn().mockResolvedValue(offers),
      count: vi.fn().mockResolvedValue(total),
    },
    offerCategory: {
      findMany: vi.fn().mockResolvedValue(categories),
    },
  } as unknown as PrismaClient
}

const OFFER = {
  id: 'offer-1',
  providerName: 'Marcus by Goldman Sachs',
  title: 'Easy Access Savings',
  affiliateNetwork: 'direct',
  commissionType: 'cpa',
  commissionValue: 25,
  requiresBankLink: false,
  isActive: true,
  category: { slug: 'savings', name: 'Savings Accounts' },
}

describe('offersListPage', () => {
  it('renders provider name in the table', async () => {
    const prisma = makePrisma([OFFER], 1, [{ slug: 'savings', name: 'Savings Accounts' }])
    const html = await offersListPage(prisma, {})
    expect(html).toContain('Marcus by Goldman Sachs')
  })

  it('renders active badge for active offer', async () => {
    const prisma = makePrisma([OFFER], 1)
    const html = await offersListPage(prisma, {})
    expect(html).toContain('badge-green')
    expect(html).toContain('Active')
  })

  it('renders inactive badge for inactive offer', async () => {
    const inactiveOffer = { ...OFFER, isActive: false }
    const prisma = makePrisma([inactiveOffer], 1)
    const html = await offersListPage(prisma, {})
    expect(html).toContain('badge-grey')
    expect(html).toContain('Inactive')
  })

  it('displays CPA commission as £ amount', async () => {
    const prisma = makePrisma([OFFER], 1)
    const html = await offersListPage(prisma, {})
    expect(html).toContain('£25')
  })

  it('displays revenue share commission as percentage', async () => {
    const rsOffer = { ...OFFER, commissionType: 'revenue_share', commissionValue: 0.2 }
    const prisma = makePrisma([rsOffer], 1)
    const html = await offersListPage(prisma, {})
    expect(html).toContain('20%')
  })

  it('renders empty state when no offers', async () => {
    const prisma = makePrisma([], 0)
    const html = await offersListPage(prisma, {})
    expect(html).toContain('No offers found')
  })

  it('renders filter form with category dropdown', async () => {
    const categories = [
      { slug: 'savings', name: 'Savings Accounts' },
      { slug: 'broadband', name: 'Broadband' },
    ]
    const prisma = makePrisma([], 0, categories)
    const html = await offersListPage(prisma, {})
    expect(html).toContain('Savings Accounts')
    expect(html).toContain('Broadband')
  })

  it('HTML-escapes provider name to prevent XSS', async () => {
    const xssOffer = { ...OFFER, providerName: '<script>alert(1)</script>' }
    const prisma = makePrisma([xssOffer], 1)
    const html = await offersListPage(prisma, {})
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('shows pagination when total exceeds page size', async () => {
    const offers = Array.from({ length: 25 }, (_, i) => ({ ...OFFER, id: `offer-${i}`, providerName: `Provider ${i}` }))
    const prisma = makePrisma(offers, 50)
    const html = await offersListPage(prisma, { page: '1' })
    expect(html).toContain('Next')
  })
})
