import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { getUpcomingBills, isBillCalendarRequest } from '../billCalendarService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const TODAY = new Date()
const IN_5_DAYS = new Date(TODAY); IN_5_DAYS.setDate(TODAY.getDate() + 5)
const IN_40_DAYS = new Date(TODAY); IN_40_DAYS.setDate(TODAY.getDate() + 40)

function makePrisma(opts: {
  recurring?: Array<{ merchantName: string; typicalAmount: Decimal; frequency: string; nextExpectedDate: Date | null }>
  balance?: number
} = {}): PrismaClient {
  const { recurring = [], balance = 5000 } = opts
  return {
    recurringPayment: {
      findMany: vi.fn().mockResolvedValue(recurring),
    },
    account: {
      findMany: vi.fn().mockResolvedValue([{ currentBalance: new Decimal(balance) }]),
    },
  } as unknown as PrismaClient
}

describe('getUpcomingBills', () => {
  it('returns no-recurring message when user has no recurring payments', async () => {
    const prisma = makePrisma({ recurring: [] })
    const result = await getUpcomingBills(prisma, 'user-1')
    expect(result).toMatch(/haven.*t detected|connect.*bank/i)
    expect(prisma.account.findMany).not.toHaveBeenCalled()
  })

  it('returns bill due within 30 days', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'Netflix', typicalAmount: new Decimal(15.99), frequency: 'monthly', nextExpectedDate: IN_5_DAYS }],
      balance: 500,
    })
    const result = await getUpcomingBills(prisma, 'user-1')
    expect(result).toMatch(/Netflix/)
    expect(result).toMatch(/15\.99/)
  })

  it('excludes bills beyond 30-day horizon', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'AnnualFee', typicalAmount: new Decimal(99), frequency: 'annual', nextExpectedDate: IN_40_DAYS }],
      balance: 500,
    })
    const result = await getUpcomingBills(prisma, 'user-1')
    expect(result).not.toMatch(/AnnualFee/)
    expect(result).toMatch(/none are due/i)
  })

  it('shows affordability warning when bills exceed balance', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'Rent', typicalAmount: new Decimal(1200), frequency: 'monthly', nextExpectedDate: IN_5_DAYS }],
      balance: 800,
    })
    const result = await getUpcomingBills(prisma, 'user-1')
    expect(result).toMatch(/heads up|exceed/i)
  })

  it('shows current balance in result', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'Spotify', typicalAmount: new Decimal(9.99), frequency: 'monthly', nextExpectedDate: IN_5_DAYS }],
      balance: 3456.78,
    })
    const result = await getUpcomingBills(prisma, 'user-1')
    expect(result).toMatch(/3,456/)
  })
})

describe('isBillCalendarRequest', () => {
  it('matches upcoming bill queries', () => {
    expect(isBillCalendarRequest('show my upcoming bills')).toBe(true)
    expect(isBillCalendarRequest('what payments are due this month?')).toBe(true)
    expect(isBillCalendarRequest('when is my next payment?')).toBe(true)
    expect(isBillCalendarRequest('direct debit calendar')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isBillCalendarRequest('how much did I spend on coffee?')).toBe(false)
    expect(isBillCalendarRequest('what is my balance?')).toBe(false)
  })
})
