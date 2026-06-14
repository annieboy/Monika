import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  detectDuplicateTransactions,
  formatDuplicateTransactions,
  type DuplicateGroup,
} from '../duplicateTransactionService.js'

const NOW = new Date('2026-03-15T12:00:00Z')

function makeRow(opts: {
  id: string
  merchantNameClean?: string
  merchantName?: string
  amount: number
  date: Date
}) {
  return {
    id: opts.id,
    transactionDate: opts.date,
    merchantNameClean: opts.merchantNameClean ?? null,
    merchantName: opts.merchantName ?? null,
    amount: opts.amount,
    cleanDescription: null,
    rawDescription: null,
  }
}

function makePrisma(rows: ReturnType<typeof makeRow>[]) {
  return {
    transaction: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaClient
}

describe('detectDuplicateTransactions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns empty when no transactions', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma([])
    const result = await detectDuplicateTransactions(prisma, 'u1')
    expect(result).toHaveLength(0)
  })

  it('detects duplicate charge from same merchant within 24h', async () => {
    vi.setSystemTime(NOW)
    const base = new Date('2026-03-10T10:00:00Z')
    const close = new Date('2026-03-10T14:00:00Z') // 4h later
    const prisma = makePrisma([
      makeRow({ id: 'a', merchantNameClean: 'Netflix', amount: -15.99, date: base }),
      makeRow({ id: 'b', merchantNameClean: 'Netflix', amount: -15.99, date: close }),
    ])
    const result = await detectDuplicateTransactions(prisma, 'u1')
    expect(result).toHaveLength(1)
    expect(result[0]!.merchant).toBe('Netflix')
    expect(result[0]!.transactions).toHaveLength(2)
  })

  it('does not flag transactions more than 24h apart', async () => {
    vi.setSystemTime(NOW)
    const prisma = makePrisma([
      makeRow({ id: 'a', merchantNameClean: 'Tesco', amount: -42.00, date: new Date('2026-03-10T10:00:00Z') }),
      makeRow({ id: 'b', merchantNameClean: 'Tesco', amount: -42.00, date: new Date('2026-03-12T10:00:00Z') }),
    ])
    const result = await detectDuplicateTransactions(prisma, 'u1')
    expect(result).toHaveLength(0)
  })

  it('does not flag transactions with different amounts', async () => {
    vi.setSystemTime(NOW)
    const date = new Date('2026-03-10T10:00:00Z')
    const prisma = makePrisma([
      makeRow({ id: 'a', merchantNameClean: 'Amazon', amount: -50.00, date }),
      makeRow({ id: 'b', merchantNameClean: 'Amazon', amount: -99.99, date }),
    ])
    const result = await detectDuplicateTransactions(prisma, 'u1')
    expect(result).toHaveLength(0)
  })

  it('tolerates 1% amount difference', async () => {
    vi.setSystemTime(NOW)
    const date = new Date('2026-03-10T10:00:00Z')
    const prisma = makePrisma([
      makeRow({ id: 'a', merchantNameClean: 'Deliveroo', amount: -25.00, date }),
      makeRow({ id: 'b', merchantNameClean: 'Deliveroo', amount: -25.20, date }), // 0.8% diff
    ])
    const result = await detectDuplicateTransactions(prisma, 'u1')
    expect(result).toHaveLength(1)
  })

  it('returns multiple groups when multiple duplicates exist', async () => {
    vi.setSystemTime(NOW)
    const d1 = new Date('2026-03-10T10:00:00Z')
    const d2 = new Date('2026-03-11T10:00:00Z')
    const prisma = makePrisma([
      makeRow({ id: 'a1', merchantNameClean: 'Spotify', amount: -9.99, date: d1 }),
      makeRow({ id: 'a2', merchantNameClean: 'Spotify', amount: -9.99, date: new Date(d1.getTime() + 3600000) }),
      makeRow({ id: 'b1', merchantNameClean: 'Gym', amount: -45.00, date: d2 }),
      makeRow({ id: 'b2', merchantNameClean: 'Gym', amount: -45.00, date: new Date(d2.getTime() + 7200000) }),
    ])
    const result = await detectDuplicateTransactions(prisma, 'u1')
    expect(result).toHaveLength(2)
  })
})

describe('formatDuplicateTransactions', () => {
  it('returns clean message when no duplicates', () => {
    const out = formatDuplicateTransactions([])
    expect(out).toMatch(/No potential duplicate/)
  })

  it('shows merchant name and amount', () => {
    const groups: DuplicateGroup[] = [{
      merchant: 'Netflix',
      amount: 15.99,
      transactions: [
        { id: 'a', date: new Date('2026-03-10T10:00:00Z'), description: null },
        { id: 'b', date: new Date('2026-03-10T14:00:00Z'), description: null },
      ],
    }]
    const out = formatDuplicateTransactions(groups)
    expect(out).toMatch(/Netflix/)
    expect(out).toMatch(/£15\.99/)
    expect(out).toMatch(/1 potential duplicate charge detected/)
  })

  it('includes refund advice', () => {
    const groups: DuplicateGroup[] = [{
      merchant: 'Tesco',
      amount: 42,
      transactions: [
        { id: 'a', date: new Date(), description: null },
        { id: 'b', date: new Date(), description: null },
      ],
    }]
    const out = formatDuplicateTransactions(groups)
    expect(out).toMatch(/refund/i)
  })
})
