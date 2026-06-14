import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getCharitySummary, formatCharitySummary } from '../charityTrackerService.js'

const NOW = new Date('2026-06-15T12:00:00Z')

function makePrisma(donationRows: object[], extraRows: object[] = []) {
  let findManyCall = 0
  return {
    transaction: {
      findMany: vi.fn().mockImplementation(() => {
        findManyCall++
        return Promise.resolve(findManyCall === 1 ? donationRows : extraRows)
      }),
    },
  } as unknown as PrismaClient
}

function makeDonation(id: string, amount: number) {
  return {
    id,
    transactionDate: new Date('2026-05-10'),
    merchantNameClean: 'Oxfam',
    merchantName: 'OXFAM GB',
    amount: -amount,
    cleanDescription: null,
    rawDescription: 'OXFAM DONATION',
    category: 'charity',
  }
}

describe('getCharitySummary', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns correct total donated', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma([makeDonation('a', 50), makeDonation('b', 30)])
    const result = await getCharitySummary(prisma, 'u1', NOW)
    expect(result.totalDonated).toBe(80)
  })

  it('computes gift aid uplift at 25%', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma([makeDonation('a', 100)])
    const result = await getCharitySummary(prisma, 'u1', NOW)
    expect(result.giftAidUplift).toBe(25)
  })

  it('returns correct tax year label', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma([])
    const result = await getCharitySummary(prisma, 'u1', NOW)
    expect(result.taxYear).toBe('2026/27')
  })

  it('returns empty donations when none found', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma([], [])
    const result = await getCharitySummary(prisma, 'u1', NOW)
    expect(result.donations).toHaveLength(0)
    expect(result.totalDonated).toBe(0)
  })
})

describe('formatCharitySummary', () => {
  it('shows no donations message when empty', () => {
    const out = formatCharitySummary({
      donations: [],
      totalDonated: 0,
      giftAidUplift: 0,
      taxYear: '2026/27',
      fromDate: new Date(2026, 3, 6),
      toDate: new Date(2027, 3, 5),
    })
    expect(out).toMatch(/No charitable donations/)
  })

  it('shows total, gift aid uplift, and disclaimer', () => {
    const out = formatCharitySummary({
      donations: [{ id: 'a', date: new Date('2026-05-10'), merchant: 'Oxfam', amount: 50, description: null }],
      totalDonated: 50,
      giftAidUplift: 12.5,
      taxYear: '2026/27',
      fromDate: new Date(2026, 3, 6),
      toDate: new Date(2027, 3, 5),
    })
    expect(out).toMatch(/£50/)
    expect(out).toMatch(/Gift Aid/i)
    expect(out).toMatch(/£12\.50/)
    expect(out).toMatch(/tax adviser/i)
  })
})
