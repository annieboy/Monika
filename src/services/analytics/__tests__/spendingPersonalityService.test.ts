import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { getSpendingPersonality, isSpendingPersonalityRequest } from '../spendingPersonalityService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

function makePrisma(spending: Array<{ category: string | null; _sum: { amount: Decimal | null } }> = []): PrismaClient {
  return {
    transaction: {
      groupBy: vi.fn().mockResolvedValue(spending),
    },
  } as unknown as PrismaClient
}

describe('getSpendingPersonality', () => {
  it('returns data-needed message when no spending', async () => {
    const prisma = makePrisma([])
    const result = await getSpendingPersonality(prisma, 'user-1')
    expect(result).toMatch(/data|connect/i)
  })

  it('identifies Foodie archetype for dominant food spending', async () => {
    const prisma = makePrisma([
      { category: 'eating out', _sum: { amount: new Decimal(400) } },
      { category: 'takeaway', _sum: { amount: new Decimal(200) } },
      { category: 'transport', _sum: { amount: new Decimal(50) } },
    ])
    const result = await getSpendingPersonality(prisma, 'user-1')
    expect(result).toMatch(/Foodie/i)
  })

  it('identifies Tech Enthusiast for subscriptions-heavy spending', async () => {
    const prisma = makePrisma([
      { category: 'subscriptions', _sum: { amount: new Decimal(300) } },
      { category: 'electronics', _sum: { amount: new Decimal(200) } },
      { category: 'groceries', _sum: { amount: new Decimal(100) } },
    ])
    const result = await getSpendingPersonality(prisma, 'user-1')
    expect(result).toMatch(/Tech/i)
  })

  it('shows top 3 categories in result', async () => {
    const prisma = makePrisma([
      { category: 'eating out', _sum: { amount: new Decimal(400) } },
      { category: 'transport', _sum: { amount: new Decimal(150) } },
      { category: 'entertainment', _sum: { amount: new Decimal(100) } },
      { category: 'groceries', _sum: { amount: new Decimal(50) } },
    ])
    const result = await getSpendingPersonality(prisma, 'user-1')
    expect(result).toMatch(/eating out/i)
    expect(result).toMatch(/transport/i)
    expect(result).toMatch(/entertainment/i)
  })

  it('includes personalised tip in result', async () => {
    const prisma = makePrisma([
      { category: 'eating out', _sum: { amount: new Decimal(500) } },
    ])
    const result = await getSpendingPersonality(prisma, 'user-1')
    expect(result).toMatch(/tip|hack/i)
  })
})

describe('isSpendingPersonalityRequest', () => {
  it('matches personality queries', () => {
    expect(isSpendingPersonalityRequest('what is my spending personality?')).toBe(true)
    expect(isSpendingPersonalityRequest('what kind of spender am I?')).toBe(true)
    expect(isSpendingPersonalityRequest('show my spending profile')).toBe(true)
    expect(isSpendingPersonalityRequest('my spending habits')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isSpendingPersonalityRequest('how much did I spend on food?')).toBe(false)
    expect(isSpendingPersonalityRequest('what is my balance?')).toBe(false)
  })
})
