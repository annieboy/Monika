import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  parseSpendDown,
  createSpendDownGoal,
  listSpendDownGoals,
  handleSpendDown,
} from '../spendDownService.js'

// ── Mock factory ──────────────────────────────────────────────────────────

function makePrisma(goals: Array<{
  id: string
  name: string
  targetAmount: number
  currentAmount: number
  targetDate: Date | null
  monthlySavings: number | null
  status: string
  createdAt: Date
}> = []) {
  return {
    savingsGoal: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'goal-1', currentAmount: 0, createdAt: new Date(), ...data }),
      ),
      findMany: vi.fn().mockResolvedValue(goals),
      findFirst: vi.fn().mockResolvedValue(goals[0] ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

// ── parseSpendDown tests ──────────────────────────────────────────────────

describe('parseSpendDown', () => {
  it('parses "pay off my £3,000 credit card by June 2027" — correct name, amount, date', () => {
    const result = parseSpendDown('pay off my £3,000 credit card by June 2027')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Pay off credit card')
    expect(result!.targetAmount).toBe(3000)
    expect(result!.targetDate).toBeInstanceOf(Date)
    expect(result!.targetDate!.getFullYear()).toBe(2027)
    expect(result!.targetDate!.getMonth()).toBe(5) // June = 5
  })

  it('parses "clear my £500 overdraft in 3 months" — correct amount', () => {
    const result = parseSpendDown('clear my £500 overdraft in 3 months')
    expect(result).not.toBeNull()
    expect(result!.targetAmount).toBe(500)
    expect(result!.name).toBe('Pay off overdraft')
    expect(result!.targetDate).toBeInstanceOf(Date)
  })

  it('returns null for unrelated text', () => {
    const result = parseSpendDown('what did I spend on groceries last month?')
    expect(result).toBeNull()
  })
})

// ── createSpendDownGoal tests ─────────────────────────────────────────────

describe('createSpendDownGoal', () => {
  it('calls prisma.savingsGoal.create with correct fields and returns a string', async () => {
    const prisma = makePrisma()
    const parsed = { name: 'Pay off credit card', targetAmount: 3000, monthlyPayment: 300 }
    const result = await createSpendDownGoal(prisma, 'user-1', parsed)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(prisma.savingsGoal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          name: 'Pay off credit card',
          targetAmount: 3000,
          currentAmount: 0,
          status: 'active',
          monthlySavings: 300,
        }),
      }),
    )
  })
})

// ── listSpendDownGoals tests ──────────────────────────────────────────────

describe('listSpendDownGoals', () => {
  it('returns a message containing the goal name when one exists', async () => {
    const prisma = makePrisma([
      {
        id: 'g1',
        name: 'Pay off credit card',
        targetAmount: 3000,
        currentAmount: 600,
        targetDate: null,
        monthlySavings: null,
        status: 'active',
        createdAt: new Date(),
      },
    ])
    const result = await listSpendDownGoals(prisma, 'user-1')
    expect(result).toContain('Pay off credit card')
  })
})

// ── handleSpendDown tests ─────────────────────────────────────────────────

describe('handleSpendDown', () => {
  it('calls createSpendDownGoal (via prisma.create) when parse succeeds', async () => {
    const prisma = makePrisma()
    const result = await handleSpendDown(
      prisma,
      'user-1',
      'pay off my £1,200 personal loan at £150/month',
    )
    expect(typeof result).toBe('string')
    expect(prisma.savingsGoal.create).toHaveBeenCalled()
  })
})
