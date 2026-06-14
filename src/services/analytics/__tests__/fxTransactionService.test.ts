import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getFxTransactions, formatFxSummary } from '../fxTransactionService.js'

const NOW = new Date('2026-03-15T12:00:00Z')

function makeRow(opts: {
  id: string
  amount: number
  date?: Date
  foreignCurrency?: string | null
  cleanDescription?: string | null
  rawDescription?: string | null
}) {
  return {
    id: opts.id,
    transactionDate: opts.date ?? new Date('2026-03-10'),
    merchantNameClean: 'Merchant',
    merchantName: 'MERCHANT',
    amount: opts.amount,
    foreignCurrency: opts.foreignCurrency ?? null,
    foreignAmount: null,
    cleanDescription: opts.cleanDescription ?? null,
    rawDescription: opts.rawDescription ?? null,
  }
}

function makePrisma(rowsWithFx: ReturnType<typeof makeRow>[], rowsWithoutFx: ReturnType<typeof makeRow>[] = []) {
  let findManyCall = 0
  return {
    transaction: {
      findMany: vi.fn().mockImplementation(() => {
        findManyCall++
        return Promise.resolve(findManyCall === 1 ? rowsWithFx : rowsWithoutFx)
      }),
    },
  } as unknown as PrismaClient
}

describe('getFxTransactions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns empty summary when no fx transactions', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma([], [])
    const result = await getFxTransactions(prisma, 'u1')
    expect(result.transactions).toHaveLength(0)
    expect(result.totalGbpSpend).toBe(0)
  })

  it('computes total and estimated fee from fx rows', async () => {
    vi.setSystemTime(NOW)
    const rows = [
      makeRow({ id: 'a', amount: -100, foreignCurrency: 'USD' }),
      makeRow({ id: 'b', amount: -200, foreignCurrency: 'EUR' }),
    ]
    const prisma = makePrisma(rows, [])
    const result = await getFxTransactions(prisma, 'u1')
    expect(result.totalGbpSpend).toBe(300)
    expect(result.estimatedFxFees).toBeCloseTo(8.97, 1)
  })

  it('groups currency breakdown correctly', async () => {
    vi.setSystemTime(NOW)
    const rows = [
      makeRow({ id: 'a', amount: -50, foreignCurrency: 'USD' }),
      makeRow({ id: 'b', amount: -80, foreignCurrency: 'USD' }),
      makeRow({ id: 'c', amount: -120, foreignCurrency: 'EUR' }),
    ]
    const prisma = makePrisma(rows, [])
    const result = await getFxTransactions(prisma, 'u1')
    const usd = result.currencyBreakdown.find(c => c.currency === 'USD')
    expect(usd?.totalGbp).toBe(130)
    expect(usd?.count).toBe(2)
  })
})

describe('formatFxSummary', () => {
  it('returns no-transactions message when empty', () => {
    const out = formatFxSummary({
      transactions: [],
      totalGbpSpend: 0,
      estimatedFxFees: 0,
      currencyBreakdown: [],
      firstDate: null,
      lastDate: null,
    })
    expect(out).toMatch(/No foreign currency/)
  })

  it('shows total, fee estimate, and currency breakdown', () => {
    const out = formatFxSummary({
      transactions: [{ id: 'a', date: new Date('2026-03-10'), merchant: 'Hotel', gbpAmount: 200, foreignCurrency: 'EUR', description: null }],
      totalGbpSpend: 200,
      estimatedFxFees: 5.98,
      currencyBreakdown: [{ currency: 'EUR', totalGbp: 200, count: 1 }],
      firstDate: new Date('2026-03-10'),
      lastDate: new Date('2026-03-10'),
    })
    expect(out).toMatch(/£200/)
    expect(out).toMatch(/EUR/)
    expect(out).toMatch(/fee-free travel card/i)
  })
})
