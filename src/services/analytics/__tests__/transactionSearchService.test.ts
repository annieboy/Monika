import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  parseTransactionSearch,
  searchTransactions,
  formatTransactionSearch,
  type TransactionSearchResult,
} from '../transactionSearchService.js'

// ── parseTransactionSearch ───────────────────────────────────────────────────

describe('parseTransactionSearch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns null when no filters found', () => {
    expect(parseTransactionSearch('hello there')).toBeNull()
  })

  it('extracts merchant name from "at Tesco"', () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const f = parseTransactionSearch('Show me transactions at Tesco last month')
    expect(f?.merchantName).toBe('Tesco')
  })

  it('extracts merchant name from "from Amazon"', () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const f = parseTransactionSearch('purchases from Amazon last week')
    expect(f?.merchantName).toBe('Amazon')
  })

  it('extracts category from "spending on groceries"', () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const f = parseTransactionSearch('show spending on groceries this month')
    expect(f?.category).toBe('groceries')
  })

  it('extracts last week date range', () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const f = parseTransactionSearch('transactions last week')!
    expect(f.from).toBeDefined()
    expect(f.to).toBeDefined()
    const diffDays = (f.to!.getTime() - f.from!.getTime()) / 86_400_000
    expect(diffDays).toBeCloseTo(7, 0)
  })

  it('extracts this month date range', () => {
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))
    const f = parseTransactionSearch('transactions this month')!
    expect(f.from?.getMonth()).toBe(2) // March = 2
    expect(f.from?.getDate()).toBe(1)
  })

  it('extracts last month date range', () => {
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))
    const f = parseTransactionSearch('what did I spend last month')!
    expect(f.from?.getMonth()).toBe(1) // February = 1
    expect(f.to?.getMonth()).toBe(1)
  })

  it('extracts last N days', () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const f = parseTransactionSearch('transactions last 14 days')!
    const diffDays = (f.to!.getTime() - f.from!.getTime()) / 86_400_000
    expect(diffDays).toBeCloseTo(14, 0)
  })

  it('extracts named month', () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    const f = parseTransactionSearch('transactions in January')!
    expect(f.from?.getMonth()).toBe(0)
    expect(f.to?.getMonth()).toBe(0)
  })

  it('extracts amountGte from "over £50"', () => {
    const f = parseTransactionSearch('purchases over £50')!
    expect(f.amountGte).toBe(50)
  })

  it('extracts amountLte from "under £100"', () => {
    const f = parseTransactionSearch('transactions under £100')!
    expect(f.amountLte).toBe(100)
  })

  it('extracts refund flag', () => {
    const f = parseTransactionSearch('show me my refunds')!
    expect(f.isRefund).toBe(true)
  })

  it('extracts salary flag', () => {
    const f = parseTransactionSearch('show my salary payments')!
    expect(f.isSalary).toBe(true)
  })

  it('defaults limit to 10', () => {
    const f = parseTransactionSearch('find transactions at Tesco last week')!
    expect(f.limit).toBe(10)
  })
})

// ── searchTransactions ───────────────────────────────────────────────────────

function makePrisma(rows: object[] = []) {
  return {
    transaction: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaClient
}

describe('searchTransactions', () => {
  it('returns mapped results', async () => {
    const row = {
      id: 'tx-1',
      transactionDate: new Date('2026-01-10'),
      merchantNameClean: 'Tesco',
      merchantName: 'TESCO STORES',
      category: 'Groceries',
      amount: -42.5,
      cleanDescription: null,
      rawDescription: 'TESCO STORES 123',
    }
    const prisma = makePrisma([row])
    const results = await searchTransactions(prisma, 'u1', { merchantName: 'Tesco', limit: 10 })
    expect(results).toHaveLength(1)
    expect(results[0]!.merchant).toBe('Tesco')
    expect(results[0]!.amount).toBe(-42.5)
  })

  it('applies merchant OR filter', async () => {
    const prisma = makePrisma([])
    await searchTransactions(prisma, 'u1', { merchantName: 'Amazon', limit: 5 })
    const where = (prisma.transaction.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where
    expect(where.OR).toHaveLength(3)
  })

  it('applies date range filter', async () => {
    const prisma = makePrisma([])
    const from = new Date('2026-01-01')
    const to = new Date('2026-01-31')
    await searchTransactions(prisma, 'u1', { from, to, limit: 10 })
    const where = (prisma.transaction.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where
    expect(where.transactionDate?.gte).toBe(from)
    expect(where.transactionDate?.lte).toBe(to)
  })

  it('applies amountGte as negative lte (debit convention)', async () => {
    const prisma = makePrisma([])
    await searchTransactions(prisma, 'u1', { amountGte: 50, limit: 10 })
    const where = (prisma.transaction.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where
    expect(where.AND?.[0]).toEqual({ amount: { lte: -50 } })
  })
})

// ── formatTransactionSearch ──────────────────────────────────────────────────

describe('formatTransactionSearch', () => {
  const sample: TransactionSearchResult[] = [
    { id: 'a', date: new Date('2026-01-10'), merchant: 'Tesco', category: 'Groceries', amount: -42.5, description: null },
    { id: 'b', date: new Date('2026-01-12'), merchant: 'Sainsbury\'s', category: 'Groceries', amount: -18.0, description: null },
  ]

  it('shows found count and total', () => {
    const out = formatTransactionSearch(sample, { merchantName: 'Tesco' })
    expect(out).toMatch(/2 transactions/)
    expect(out).toMatch(/Total/)
    expect(out).toMatch(/£60\.50/)
  })

  it('shows no-results message', () => {
    const out = formatTransactionSearch([], { merchantName: 'Waitrose', from: new Date('2026-01-01') })
    expect(out).toMatch(/No transactions found/)
    expect(out).toMatch(/Waitrose/)
  })

  it('shows merchant name in header', () => {
    const out = formatTransactionSearch(sample, { merchantName: 'Tesco' })
    expect(out).toMatch(/\*Tesco\*/)
  })

  it('omits total line for single result', () => {
    const out = formatTransactionSearch([sample[0]!], {})
    expect(out).not.toMatch(/Total/)
  })
})
