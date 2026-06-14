import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { scoreTransaction, runAnomalyScoreBatch } from '../anomalyScoreService.js'
import type { UserTransactionHistory } from '../anomalyScoreService.js'

function makeHistory(overrides: Partial<UserTransactionHistory> = {}): UserTransactionHistory {
  return {
    merchants: new Map(),
    subscriptionMerchants: new Set(),
    ...overrides,
  }
}

function makeTx(overrides: Partial<{
  id: string
  userId: string
  amount: number
  merchantName: string | null
  merchantNameClean: string | null
  merchantCategory: string | null
  isSubscription: boolean
  transactionDate: Date
}> = {}) {
  return {
    id: 'tx-1',
    userId: 'user-1',
    amount: -50,
    merchantName: 'Tesco',
    merchantNameClean: 'tesco',
    merchantCategory: null,
    isSubscription: false,
    transactionDate: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  }
}

describe('scoreTransaction', () => {
  it('detects duplicate charge (same merchant, same amount, 2 days apart)', () => {
    const tx1 = makeTx({ id: 'tx-1', amount: -99.99, merchantNameClean: 'amazon', transactionDate: new Date('2024-01-10T10:00:00Z') })
    const tx2 = makeTx({ id: 'tx-2', amount: -99.99, merchantNameClean: 'amazon', transactionDate: new Date('2024-01-12T10:00:00Z') })
    const history = makeHistory()
    const result = scoreTransaction(tx2, history, [tx1, tx2])
    expect(result.anomalyScore).toBeGreaterThanOrEqual(0.9)
    expect(result.reasons).toContain('duplicate_charge')
  })

  it('scores transaction 4× merchant average with large_deviation_3x', () => {
    const history = makeHistory({
      merchants: new Map([['costa', { count: 5, avgAmount: 10 }]]),
    })
    const tx = makeTx({ amount: -40, merchantNameClean: 'costa' })
    const result = scoreTransaction(tx, history, [tx])
    expect(result.anomalyScore).toBeGreaterThanOrEqual(0.7)
    expect(result.reasons).toContain('large_deviation_3x')
  })

  it('scores new subscription merchant with 0.8', () => {
    const history = makeHistory()
    const tx = makeTx({ isSubscription: true, merchantNameClean: 'netflix', amount: -9.99 })
    const result = scoreTransaction(tx, history, [tx])
    expect(result.anomalyScore).toBeGreaterThanOrEqual(0.8)
    expect(result.reasons).toContain('new_subscription')
  })

  it('scores known merchant within normal range as ≤ 0.1', () => {
    const history = makeHistory({
      merchants: new Map([['tesco', { count: 20, avgAmount: 50 }]]),
    })
    // Amount is 1.5× average — within normal range, no unusual hour
    const tx = makeTx({ amount: -75, merchantNameClean: 'tesco', transactionDate: new Date('2024-01-15T12:00:00Z') })
    const result = scoreTransaction(tx, history, [tx])
    expect(result.anomalyScore).toBeLessThanOrEqual(0.1)
  })
})

describe('runAnomalyScoreBatch', () => {
  it('updates anomalyScore on transactions and returns scored count', async () => {
    const mockUpdate = vi.fn().mockResolvedValue({})
    const mockFindMany = vi.fn()

    // First call returns the transactions to score, second call returns historical
    mockFindMany
      .mockResolvedValueOnce([
        {
          id: 'tx-a',
          userId: 'user-1',
          amount: -50,
          merchantName: 'Tesco',
          merchantNameClean: 'tesco',
          merchantCategoryCode: null,
          isSubscription: false,
          transactionDate: new Date('2024-01-15T12:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([]) // historical transactions for user-1

    const prisma = {
      transaction: {
        findMany: mockFindMany,
        update: mockUpdate,
      },
    } as unknown as PrismaClient

    const result = await runAnomalyScoreBatch(prisma, 'user-1')
    expect(result.scored).toBe(1)
    expect(result.errors).toBe(0)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'tx-a' },
      data: { anomalyScore: expect.any(Number) },
    })
  })
})
