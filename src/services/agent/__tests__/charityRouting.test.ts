import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { routeIntent } from '../router.js'

// Minimal Prisma mock: an active bank connection and no transactions, so the
// charity tracker returns its empty-state (which still names its frame as a
// "tax year"), while the spending path returns "No spending found".
function makePrisma(): PrismaClient {
  return {
    bankConnection: { findFirst: vi.fn().mockResolvedValue({ id: 'conn' }) },
    transaction: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    account: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient
}

describe('charity routing', () => {
  it('routes a plain charity question to the tax-year tracker', async () => {
    const out = await routeIntent('spending_analysis', 'how much did I spend on charity', 'u1', makePrisma())
    expect(out.toLowerCase()).toContain('tax year')
  })

  it('routes "my charitable giving" to the tracker regardless of classified intent', async () => {
    const out = await routeIntent('unknown', 'show me my charitable giving', 'u1', makePrisma())
    expect(out.toLowerCase()).toContain('tax year')
  })

  it('does NOT force the tracker when a specific short timeframe is given', async () => {
    const out = await routeIntent('spending_analysis', 'how much did I spend on charity this month', 'u1', makePrisma())
    expect(out.toLowerCase()).not.toContain('tax year')
  })
})
