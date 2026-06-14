import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { parseGoalFromMessage, createGoal, listGoals } from '../savingsGoalService.js'

// ── parseGoalFromMessage ──────────────────────────────────────────────────────

describe('parseGoalFromMessage', () => {
  it('parses amount and name from "I want to save £2000 for a holiday by December"', () => {
    const result = parseGoalFromMessage('I want to save £2000 for a holiday by December')
    expect(result).not.toBeNull()
    expect(result!.targetAmount).toBe(2000)
    expect(result!.name.toLowerCase()).toContain('holiday')
  })

  it('parses monthly savings from "save £500/month for a car"', () => {
    const result = parseGoalFromMessage('save £500/month for a car')
    expect(result).not.toBeNull()
    expect(result!.monthlySavings).toBe(500)
    expect(result!.name.toLowerCase()).toContain('car')
  })

  it('parses "in X months" deadline', () => {
    const result = parseGoalFromMessage('I want to save £1000 for an emergency fund in 6 months')
    expect(result).not.toBeNull()
    expect(result!.targetAmount).toBe(1000)
    expect(result!.targetDate).toBeInstanceOf(Date)
  })

  it('returns null when no amount is present', () => {
    expect(parseGoalFromMessage('I want to save for a holiday')).toBeNull()
  })

  it('falls back to "Savings goal" name when no "for X" clause', () => {
    const result = parseGoalFromMessage('I want to save £500')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Savings goal')
  })
})

// ── createGoal ────────────────────────────────────────────────────────────────

function makePrisma(goals: Array<{
  id: string
  name: string
  targetAmount: number
  currentAmount: number
  targetDate: Date | null
  status: string
}> = []) {
  return {
    savingsGoal: {
      create: vi.fn().mockImplementation(({ data }: { data: { name: string; targetAmount: number } }) =>
        Promise.resolve({ id: 'goal-1', ...data, currentAmount: 0 }),
      ),
      findMany: vi.fn().mockResolvedValue(goals),
    },
  } as unknown as PrismaClient
}

describe('createGoal', () => {
  it('creates goal and returns confirmation with monthly savings estimate', async () => {
    const prisma = makePrisma()
    const response = await createGoal(prisma, 'user-1', {
      name: 'holiday',
      targetAmount: 2000,
      targetDate: undefined,
      monthlySavings: 200,
    })
    expect(response).toMatch(/holiday/i)
    expect(response).toMatch(/£2,000/)
    expect(response).toMatch(/10 months/i)
    expect(prisma.savingsGoal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'holiday', targetAmount: 2000 }),
      }),
    )
  })

  it('creates goal and returns deadline-based monthly requirement', async () => {
    const targetDate = new Date(Date.now() + 6 * 30 * 86_400_000)
    const prisma = makePrisma()
    const response = await createGoal(prisma, 'user-1', {
      name: 'emergency fund',
      targetAmount: 1200,
      targetDate,
      monthlySavings: undefined,
    })
    expect(response).toMatch(/emergency fund/i)
    expect(response).toMatch(/£200/)
  })
})

// ── listGoals ─────────────────────────────────────────────────────────────────

describe('listGoals', () => {
  it('shows goal progress bars', async () => {
    const prisma = makePrisma([
      {
        id: 'g1',
        name: 'Holiday',
        targetAmount: 2000,
        currentAmount: 1000,
        targetDate: null,
        status: 'active',
      },
    ])
    const response = await listGoals(prisma, 'user-1')
    expect(response).toMatch(/Holiday/i)
    expect(response).toMatch(/50%/)
  })

  it('returns empty state message when no goals set', async () => {
    const prisma = makePrisma([])
    const response = await listGoals(prisma, 'user-1')
    expect(response).toMatch(/don't have any savings goals/i)
  })

  it('marks achieved goals with a tick', async () => {
    const prisma = makePrisma([
      {
        id: 'g2',
        name: 'Emergency fund',
        targetAmount: 1000,
        currentAmount: 1000,
        targetDate: null,
        status: 'achieved',
      },
    ])
    const response = await listGoals(prisma, 'user-1')
    expect(response).toContain('✅')
  })
})
