import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { parseBudgetSet, parseBudgetQuery, isListBudgetsRequest, handleBudget } from '../budgetService.js'

vi.mock('../../analytics/analytics.js', () => ({
  TransactionAnalyticsService: vi.fn(function () {
    return {
      getSpendingByCategory: vi.fn().mockResolvedValue([{ category: 'eating out', amount: 80 }]),
    }
  }),
}))

const USER_ID = 'user-1'

function makePrisma(opts: {
  budgets?: Array<{ category: string; amount: number }>
} = {}) {
  const rows = (opts.budgets ?? []).map(b => ({
    eventData: { category: b.category, amount: b.amount },
  }))

  return {
    auditLog: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { eventData?: { path: string[]; equals: string } } }) => {
        const cat = where.eventData?.equals
        const found = rows.find(r => (r.eventData as { category: string }).category === cat)
        return Promise.resolve(found ?? null)
      }),
      findMany: vi.fn().mockResolvedValue(rows),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('parseBudgetSet', () => {
  it('parses "set a £200 budget for eating out"', () => {
    const result = parseBudgetSet('set a £200 budget for eating out')
    expect(result).toEqual({ category: 'eating out', amount: 200 })
  })

  it('parses "set my groceries budget to £300"', () => {
    const result = parseBudgetSet('set my groceries budget to £300')
    expect(result).toEqual({ category: 'groceries', amount: 300 })
  })

  it('returns null for non-budget messages', () => {
    expect(parseBudgetSet('what is my balance?')).toBeNull()
  })
})

describe('parseBudgetQuery', () => {
  it('extracts category from "what\'s my food budget?"', () => {
    expect(parseBudgetQuery("what's my food budget?")).toBe('food')
  })

  it('returns null for non-query messages', () => {
    expect(parseBudgetQuery('hello')).toBeNull()
  })
})

describe('isListBudgetsRequest', () => {
  it('matches "my budgets"', () => expect(isListBudgetsRequest('my budgets')).toBe(true))
  it('matches "show me my budgets"', () => expect(isListBudgetsRequest('show me my budgets')).toBe(true))
  it('does not match unrelated message', () => expect(isListBudgetsRequest('my spending')).toBe(false))
})

describe('handleBudget', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets a budget and confirms', async () => {
    const prisma = makePrisma()
    const result = await handleBudget(prisma, USER_ID, 'set a £200 budget for eating out')
    expect(result).toMatch(/Budget set/i)
    expect(result).toMatch(/£200/)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'budget_set',
          eventData: { category: 'eating out', amount: 200 },
        }),
      }),
    )
  })

  it('shows budget progress when querying a specific category', async () => {
    const prisma = makePrisma({ budgets: [{ category: 'food', amount: 200 }] })
    const result = await handleBudget(prisma, USER_ID, "what's my food budget?")
    expect(result).toMatch(/food budget/i)
    expect(result).toMatch(/£200/)
  })

  it('lists all budgets with progress bars', async () => {
    const prisma = makePrisma({ budgets: [{ category: 'eating out', amount: 200 }] })
    const result = await handleBudget(prisma, USER_ID, 'my budgets')
    expect(result).toMatch(/eating out/i)
    expect(result).toMatch(/£200/)
  })

  it('shows helper message when no set/query match', async () => {
    const prisma = makePrisma()
    const result = await handleBudget(prisma, USER_ID, 'budget info')
    expect(result).toMatch(/set a/i)
  })

  it('returns "not set yet" when querying unset category', async () => {
    const prisma = makePrisma({ budgets: [] })
    const result = await handleBudget(prisma, USER_ID, "what's my transport budget?")
    expect(result).toMatch(/haven't set a budget/i)
  })
})
