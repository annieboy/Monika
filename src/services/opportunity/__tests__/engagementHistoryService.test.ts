import { describe, it, expect, vi } from 'vitest'
import { loadEngagementHistory } from '../engagementHistoryService.js'
import type { PrismaClient } from '@prisma/client'

function makePrisma(userRows: unknown[], globalRows: unknown[]): PrismaClient {
  return {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce(userRows)
      .mockResolvedValueOnce(globalRows),
  } as unknown as PrismaClient
}

describe('loadEngagementHistory', () => {
  it('uses personal rates when user has ≥3 delivered', async () => {
    const userRows = [{
      categorySlug: 'savings',
      delivered: 5,
      clicks: 3,
      conversions: 1,
      dismissals: 1,
    }]
    const globalRows = [{
      categorySlug: 'savings',
      delivered: 100,
      clicks: 10,
      conversions: 2,
      dismissals: 30,
    }]

    const prisma = makePrisma(userRows, globalRows)
    const history = await loadEngagementHistory(prisma, 'user-1')

    // Should use personal rates (5 delivered ≥ 3 threshold)
    expect(history.byCategory['savings']).toEqual({
      delivered: 5,
      clicks: 3,
      conversions: 1,
      dismissals: 1,
    })
  })

  it('falls back to global rates when user has fewer than 3 delivered', async () => {
    const userRows = [{
      categorySlug: 'broadband',
      delivered: 2,
      clicks: 1,
      conversions: 0,
      dismissals: 1,
    }]
    const globalRows = [{
      categorySlug: 'broadband',
      delivered: 50,
      clicks: 20,
      conversions: 5,
      dismissals: 10,
    }]

    const prisma = makePrisma(userRows, globalRows)
    const history = await loadEngagementHistory(prisma, 'user-1')

    // Should fall back to global rates (2 delivered < 3 threshold)
    expect(history.byCategory['broadband']).toEqual({
      delivered: 50,
      clicks: 20,
      conversions: 5,
      dismissals: 10,
    })
  })

  it('returns empty history when user is new and no global data', async () => {
    const prisma = makePrisma([], [])
    const history = await loadEngagementHistory(prisma, 'new-user')

    expect(history.byCategory).toEqual({})
  })

  it('includes categories from global that user has no history for', async () => {
    const userRows: unknown[] = []
    const globalRows = [
      { categorySlug: 'savings',   delivered: 20, clicks: 5,  conversions: 2, dismissals: 5 },
      { categorySlug: 'broadband', delivered: 15, clicks: 8,  conversions: 3, dismissals: 2 },
    ]

    const prisma = makePrisma(userRows, globalRows)
    const history = await loadEngagementHistory(prisma, 'user-new')

    expect(Object.keys(history.byCategory)).toEqual(['savings', 'broadband'])
  })

  it('excludes categories with zero global delivery (no meaningful signal)', async () => {
    const userRows: unknown[] = []
    const globalRows = [
      { categorySlug: 'savings',  delivered: 0, clicks: 0, conversions: 0, dismissals: 0 },
    ]

    const prisma = makePrisma(userRows, globalRows)
    const history = await loadEngagementHistory(prisma, 'user-1')

    expect(history.byCategory['savings']).toBeUndefined()
  })
})
