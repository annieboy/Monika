import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { suggestFinancialGoals, isGoalSuggestionRequest } from '../goalSuggestionService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

function makePrisma(opts: {
  spending?: Array<{ category: string | null; _sum: { amount: Decimal | null } }>
  balance?: number
  goals?: Array<{ name: string }>
} = {}): PrismaClient {
  const { spending = [], balance = 500, goals = [] } = opts
  return {
    transaction: { groupBy: vi.fn().mockResolvedValue(spending) },
    account: { findMany: vi.fn().mockResolvedValue([{ currentBalance: new Decimal(balance) }]) },
    savingsGoal: { findMany: vi.fn().mockResolvedValue(goals) },
  } as unknown as PrismaClient
}

describe('suggestFinancialGoals', () => {
  it('suggests emergency fund when balance is low', async () => {
    const prisma = makePrisma({
      spending: [
        { category: 'groceries', _sum: { amount: new Decimal(600) } },
        { category: 'rent', _sum: { amount: new Decimal(1500) } },
      ],
      balance: 300,
    })
    const result = await suggestFinancialGoals(prisma, 'user-1')
    expect(result).toMatch(/emergency fund/i)
  })

  it('suggests holiday fund when travel spending detected', async () => {
    const prisma = makePrisma({
      spending: [
        { category: 'travel', _sum: { amount: new Decimal(500) } },
        { category: 'groceries', _sum: { amount: new Decimal(300) } },
      ],
      balance: 5000,
    })
    const result = await suggestFinancialGoals(prisma, 'user-1')
    expect(result).toMatch(/holiday/i)
  })

  it('suggests house deposit when high rent detected', async () => {
    const prisma = makePrisma({
      spending: [
        { category: 'rent', _sum: { amount: new Decimal(3600) } }, // £1200/month
      ],
      balance: 5000,
    })
    const result = await suggestFinancialGoals(prisma, 'user-1')
    expect(result).toMatch(/house deposit|lifetime ISA|LISA/i)
  })

  it('skips goals user already has', async () => {
    const prisma = makePrisma({
      spending: [{ category: 'travel', _sum: { amount: new Decimal(500) } }],
      balance: 5000,
      goals: [{ name: 'Holiday fund 2026' }],
    })
    const result = await suggestFinancialGoals(prisma, 'user-1')
    expect(result).not.toMatch(/holiday fund/i)
  })

  it('reports existing goals when all goals already set', async () => {
    const prisma = makePrisma({
      spending: [],
      balance: 10000,
      goals: [{ name: 'Emergency fund' }],
    })
    const result = await suggestFinancialGoals(prisma, 'user-1')
    expect(result).toMatch(/already have|great work/i)
  })

  it('includes disclaimer', async () => {
    const prisma = makePrisma({
      spending: [{ category: 'travel', _sum: { amount: new Decimal(500) } }],
      balance: 5000,
    })
    const result = await suggestFinancialGoals(prisma, 'user-1')
    expect(result).toMatch(/not financial advice/i)
  })
})

describe('isGoalSuggestionRequest', () => {
  it('matches goal suggestion queries', () => {
    expect(isGoalSuggestionRequest('suggest a savings goal for me')).toBe(true)
    expect(isGoalSuggestionRequest('what should I save for?')).toBe(true)
    expect(isGoalSuggestionRequest('recommend a financial goal')).toBe(true)
    expect(isGoalSuggestionRequest('suggest financial goals for me')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isGoalSuggestionRequest('show my savings goals')).toBe(false)
    expect(isGoalSuggestionRequest('I want to save £500 for a holiday')).toBe(false)
  })
})
