import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import {
  calculatePropertyAffordability,
  isPropertyAffordabilityRequest,
} from '../propertyAffordabilityService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

function makePrisma(monthlyIncome = 0): PrismaClient {
  // 3 months of salary credits (negative = credit)
  const transactions = Array.from({ length: 3 }, () => ({
    amount: new Decimal(-monthlyIncome),
  }))
  return {
    transaction: { findMany: vi.fn().mockResolvedValue(monthlyIncome > 0 ? transactions : []) },
  } as unknown as PrismaClient
}

describe('calculatePropertyAffordability', () => {
  it('returns no-data message when no income detected', async () => {
    const prisma = makePrisma(0)
    const result = await calculatePropertyAffordability(prisma, 'user-1', 'how much can I borrow?')
    expect(result).toMatch(/income|connect/i)
  })

  it('shows 4.5x and 5.5x borrowing multiples', async () => {
    const prisma = makePrisma(4000) // £48k/year
    const result = await calculatePropertyAffordability(prisma, 'user-1', 'how much mortgage?')
    // 4.5 × £48,000 = £216,000
    expect(result).toMatch(/216,000/)
    // 5.5 × £48,000 = £264,000
    expect(result).toMatch(/264,000/)
  })

  it('uses deposit from message if provided', async () => {
    const prisma = makePrisma(4000)
    const result = await calculatePropertyAffordability(prisma, 'user-1', 'mortgage with £50,000 deposit')
    expect(result).toMatch(/50,000/)
  })

  it('shows monthly repayment for 25 and 35 year terms', async () => {
    const prisma = makePrisma(4000)
    const result = await calculatePropertyAffordability(prisma, 'user-1', 'house affordability')
    expect(result).toMatch(/25-year|25 year/i)
    expect(result).toMatch(/35-year|35 year/i)
  })

  it('includes FCA mortgage disclaimer', async () => {
    const prisma = makePrisma(4000)
    const result = await calculatePropertyAffordability(prisma, 'user-1', 'can I afford a house?')
    expect(result).toMatch(/not financial advice|mortgage broker/i)
  })
})

describe('isPropertyAffordabilityRequest', () => {
  it('matches mortgage affordability queries', () => {
    expect(isPropertyAffordabilityRequest('how much mortgage can I get?')).toBe(true)
    expect(isPropertyAffordabilityRequest('can I afford a house?')).toBe(true)
    expect(isPropertyAffordabilityRequest('property affordability check')).toBe(true)
    expect(isPropertyAffordabilityRequest('first-time buyer tips')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isPropertyAffordabilityRequest('can I afford a new laptop?')).toBe(false)
    expect(isPropertyAffordabilityRequest('what is my balance?')).toBe(false)
  })
})
