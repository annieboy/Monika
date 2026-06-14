import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  parseSimulation,
  runSavingsSimulation,
  formatSimulationResult,
} from '../savingsSimulationService.js'

// ── parseSimulation ───────────────────────────────────────────────────────────

describe('parseSimulation', () => {
  it('returns null for unrelated message', () => {
    expect(parseSimulation('what is my balance')).toBeNull()
  })

  it('parses monthly saving amount', () => {
    const r = parseSimulation('if I save £200/month how long to reach £2000')
    expect(r?.monthlySaving).toBe(200)
  })

  it('parses cut by amount', () => {
    const r = parseSimulation('if I cut eating out by £50 how long to reach £1,000')
    expect(r?.monthlySaving).toBe(50)
  })

  it('parses explicit target amount', () => {
    const r = parseSimulation('if I save £150/month how long to reach £3,000')
    expect(r?.targetAmount).toBe(3000)
  })

  it('parses goal name', () => {
    const r = parseSimulation('if I save £200/month how long for my holiday')
    expect(r?.goalName).toBe('holiday')
  })

  it('returns null when amount is missing', () => {
    expect(parseSimulation('if I save a lot how long to reach my goal')).toBeNull()
  })
})

// ── runSavingsSimulation ──────────────────────────────────────────────────────

function makePrisma(goal?: { name: string; targetAmount: number; currentAmount: number } | null) {
  return {
    savingsGoal: {
      findFirst: vi.fn().mockResolvedValue(goal ?? null),
    },
  } as unknown as PrismaClient
}

describe('runSavingsSimulation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses explicit target when provided', async () => {
    vi.setSystemTime(new Date('2026-01-01'))
    const prisma = makePrisma(null)
    const result = await runSavingsSimulation(prisma, 'u1', { monthlySaving: 200, targetAmount: 1000 })
    expect(result.targetAmount).toBe(1000)
    expect(result.monthsToTarget).toBe(5)
  })

  it('uses active goal target when no explicit target', async () => {
    vi.setSystemTime(new Date('2026-01-01'))
    const prisma = makePrisma({ name: 'Holiday', targetAmount: 2000, currentAmount: 500 })
    const result = await runSavingsSimulation(prisma, 'u1', { monthlySaving: 150 })
    expect(result.targetAmount).toBe(2000)
    expect(result.currentSaved).toBe(500)
    expect(result.monthsToTarget).toBe(Math.ceil(1500 / 150))
  })

  it('falls back to £1000 target when no goal and no explicit target', async () => {
    vi.setSystemTime(new Date('2026-01-01'))
    const prisma = makePrisma(null)
    const result = await runSavingsSimulation(prisma, 'u1', { monthlySaving: 100 })
    expect(result.targetAmount).toBe(1000)
  })

  it('marks alreadyAchieved when currentSaved >= target', async () => {
    vi.setSystemTime(new Date('2026-01-01'))
    const prisma = makePrisma({ name: 'Car', targetAmount: 1000, currentAmount: 1200 })
    const result = await runSavingsSimulation(prisma, 'u1', { monthlySaving: 100 })
    expect(result.alreadyAchieved).toBe(true)
    expect(result.monthsToTarget).toBe(0)
  })

  it('projects future date correctly', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const prisma = makePrisma(null)
    const result = await runSavingsSimulation(prisma, 'u1', { monthlySaving: 500, targetAmount: 1000 })
    expect(result.monthsToTarget).toBe(2)
    expect(result.projectedDate.getFullYear()).toBe(2026)
    expect(result.projectedDate.getMonth()).toBe(2) // March = 2
  })
})

// ── formatSimulationResult ────────────────────────────────────────────────────

describe('formatSimulationResult', () => {
  it('shows months and goal name', () => {
    const out = formatSimulationResult({
      monthlySaving: 200,
      targetAmount: 2000,
      goalName: 'Holiday',
      currentSaved: 0,
      monthsToTarget: 10,
      projectedDate: new Date('2026-11-01'),
      alreadyAchieved: false,
    })
    expect(out).toMatch(/Holiday/)
    expect(out).toMatch(/10 months/)
    expect(out).toMatch(/£200/)
  })

  it('shows congratulations when already achieved', () => {
    const out = formatSimulationResult({
      monthlySaving: 100,
      targetAmount: 500,
      goalName: 'Emergency fund',
      currentSaved: 500,
      monthsToTarget: 0,
      projectedDate: new Date(),
      alreadyAchieved: true,
    })
    expect(out).toMatch(/already reached/)
    expect(out).toMatch(/Emergency fund/)
  })
})
