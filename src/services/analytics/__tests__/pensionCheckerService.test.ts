import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { checkPensionContributions, isPensionRequest } from '../pensionCheckerService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

function makePrisma(opts: {
  transactions?: Array<{ amount: Decimal; category: string | null; rawDescription: string | null }>
  balance?: number
} = {}): PrismaClient {
  const { transactions = [], balance = 5000 } = opts
  return {
    transaction: { findMany: vi.fn().mockResolvedValue(transactions) },
    account: { findMany: vi.fn().mockResolvedValue([{ currentBalance: new Decimal(balance) }]) },
  } as unknown as PrismaClient
}

describe('checkPensionContributions', () => {
  it('reports no pension detected when no pension transactions', async () => {
    const prisma = makePrisma({ transactions: [] })
    const result = await checkPensionContributions(prisma, 'user-1', 'check my pension')
    expect(result).toMatch(/couldn.*t detect|no.*pension/i)
  })

  it('detects pension by keyword in raw description', async () => {
    const prisma = makePrisma({
      transactions: [
        { amount: new Decimal(200), category: null, rawDescription: 'NEST PENSION CONTRIBUTION' },
        { amount: new Decimal(200), category: null, rawDescription: 'NEST PENSION CONTRIBUTION' },
        { amount: new Decimal(200), category: null, rawDescription: 'NEST PENSION CONTRIBUTION' },
        // salary credits
        { amount: new Decimal(-3000), category: 'salary', rawDescription: 'Salary' },
        { amount: new Decimal(-3000), category: 'salary', rawDescription: 'Salary' },
        { amount: new Decimal(-3000), category: 'salary', rawDescription: 'Salary' },
      ],
    })
    const result = await checkPensionContributions(prisma, 'user-1', 'check my pension')
    expect(result).toMatch(/200.*month|detected.*pension/i)
  })

  it('gives age-specific advice when age provided in message', async () => {
    const prisma = makePrisma({
      transactions: [
        { amount: new Decimal(200), category: 'pension', rawDescription: 'PENSION' },
        { amount: new Decimal(-3000), category: 'salary', rawDescription: 'Salary' },
      ],
    })
    const result = await checkPensionContributions(prisma, 'user-1', "check my pension I'm 35")
    expect(result).toMatch(/age 35|17\.5%/i)
  })

  it('includes FCA disclaimer', async () => {
    const prisma = makePrisma()
    const result = await checkPensionContributions(prisma, 'user-1', 'pension check')
    expect(result).toMatch(/not financial advice|regulated.*adviser/i)
  })
})

describe('isPensionRequest', () => {
  it('matches pension queries', () => {
    expect(isPensionRequest('check my pension contributions')).toBe(true)
    expect(isPensionRequest('am I saving enough for retirement?')).toBe(true)
    expect(isPensionRequest('my workplace pension')).toBe(true)
    expect(isPensionRequest('should I open a SIPP?')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isPensionRequest('what is my balance?')).toBe(false)
    expect(isPensionRequest('how much did I spend on food?')).toBe(false)
  })
})
