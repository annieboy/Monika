import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import {
  parseCreditSimulation,
  simulateCreditImpact,
  isCreditSimulationRequest,
} from '../creditSimulationService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

function makePrisma(balance = 1500): PrismaClient {
  return {
    account: { findMany: vi.fn().mockResolvedValue([{ currentBalance: new Decimal(balance), accountType: 'CURRENT' }]) },
    recurringPayment: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient
}

describe('parseCreditSimulation', () => {
  it('parses overdraft scenario', () => {
    const s = parseCreditSimulation('What if I paid off my overdraft?')
    expect(s?.type).toBe('pay_off_overdraft')
  })

  it('parses credit utilisation scenario with amount', () => {
    const s = parseCreditSimulation('What if I reduced my credit card balance by £500?')
    expect(s?.type).toBe('reduce_credit_utilisation')
    expect(s?.amount).toBe(500)
  })

  it('parses register to vote scenario', () => {
    const s = parseCreditSimulation('What if I register to vote?')
    expect(s?.type).toBe('register_to_vote')
  })

  it('parses savings buffer scenario', () => {
    const s = parseCreditSimulation('What if I built a £1,000 savings buffer?')
    expect(s?.type).toBe('build_savings_buffer')
    expect(s?.amount).toBe(1000)
  })

  it('returns null for non-simulation queries', () => {
    expect(parseCreditSimulation('What is my balance?')).toBeNull()
    expect(parseCreditSimulation('show my subscriptions')).toBeNull()
  })
})

describe('simulateCreditImpact', () => {
  it('overdraft scenario mentions high positive effect', async () => {
    const prisma = makePrisma()
    const result = await simulateCreditImpact(prisma, 'user-1', { type: 'pay_off_overdraft' })
    expect(result).toMatch(/high positive effect/i)
    expect(result).toMatch(/overdraft/i)
  })

  it('register to vote scenario includes gov.uk link', async () => {
    const prisma = makePrisma()
    const result = await simulateCreditImpact(prisma, 'user-1', { type: 'register_to_vote' })
    expect(result).toMatch(/gov\.uk/)
  })

  it('all results include FCA disclaimer', async () => {
    const prisma = makePrisma()
    for (const type of ['pay_off_overdraft', 'reduce_credit_utilisation', 'register_to_vote', 'build_savings_buffer', 'generic'] as const) {
      const result = await simulateCreditImpact(prisma, 'user-1', { type })
      expect(result).toMatch(/not financial advice|educational simulation/i)
    }
  })

  it('generic scenario lists available scenarios', async () => {
    const prisma = makePrisma()
    const result = await simulateCreditImpact(prisma, 'user-1', { type: 'generic' })
    expect(result).toMatch(/overdraft/i)
    expect(result).toMatch(/register(?:ed)?\s+to\s+vote/i)
  })
})

describe('isCreditSimulationRequest', () => {
  it('matches what-if credit queries', () => {
    expect(isCreditSimulationRequest('What if I paid off my overdraft?')).toBe(true)
    expect(isCreditSimulationRequest('Would paying off my credit card improve my credit?')).toBe(true)
    expect(isCreditSimulationRequest('If I cleared my debt, what would happen to my credit?')).toBe(true)
  })

  it('does not match general credit queries', () => {
    expect(isCreditSimulationRequest('What is my credit score?')).toBe(false)
    expect(isCreditSimulationRequest('how much is my balance?')).toBe(false)
  })
})
