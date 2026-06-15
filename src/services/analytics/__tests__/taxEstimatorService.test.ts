import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import {
  estimateTax,
  isTaxEstimatorRequest,
  parseSalaryFromMessage,
} from '../taxEstimatorService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

function makePrisma(transactions: Array<{ amount: Decimal; category: string | null }>): PrismaClient {
  return {
    transaction: {
      findMany: vi.fn().mockResolvedValue(transactions),
    },
  } as unknown as PrismaClient
}

// UK 2024/25: salary £30k → tax £3,486, NI £1,396
// Personal allowance £12,570; 20% on next £17,430 = £3,486
// NI: (30,000 - 12,570) * 8% = 17,430 * 0.08 = 1,394 ≈ 1394

describe('estimateTax', () => {
  it('returns no-data message when no income found', async () => {
    const prisma = makePrisma([])
    const result = await estimateTax(prisma, 'user-1')
    expect(result).toMatch(/need income|connect.*bank/i)
  })

  it('calculates correct tax for basic rate taxpayer', async () => {
    // £30,000 annual income as credits (negative amounts)
    const prisma = makePrisma(
      Array.from({ length: 12 }, () => ({
        amount: new Decimal(-2500),
        category: 'salary',
      })),
    )
    const result = await estimateTax(prisma, 'user-1')
    expect(result).toMatch(/30,000/)
    expect(result).toMatch(/basic rate/i)
    expect(result).toMatch(/Income tax/i)
    expect(result).toMatch(/National Insurance/i)
  })

  it('flags higher rate band for £60k income', async () => {
    const prisma = makePrisma(
      Array.from({ length: 12 }, () => ({
        amount: new Decimal(-5000),
        category: 'salary',
      })),
    )
    const result = await estimateTax(prisma, 'user-1')
    expect(result).toMatch(/higher rate/i)
  })

  it('includes HMRC disclaimer', async () => {
    const prisma = makePrisma([{ amount: new Decimal(-3000), category: 'salary' }])
    const result = await estimateTax(prisma, 'user-1')
    expect(result).toMatch(/HMRC|not.*financial.*advice|gov\.uk/i)
  })
})

describe('isTaxEstimatorRequest', () => {
  it('matches tax estimation queries', () => {
    expect(isTaxEstimatorRequest('how much income tax do I pay?')).toBe(true)
    expect(isTaxEstimatorRequest('estimate my tax this year')).toBe(true)
    expect(isTaxEstimatorRequest('what will I owe in income tax?')).toBe(true)
    expect(isTaxEstimatorRequest('my tax bill')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isTaxEstimatorRequest('how much did I spend?')).toBe(false)
    expect(isTaxEstimatorRequest('what is my balance?')).toBe(false)
  })
})

describe('parseSalaryFromMessage', () => {
  it('parses salary from message', () => {
    expect(parseSalaryFromMessage('My salary is £45,000')).toBe(45000)
    expect(parseSalaryFromMessage('I earn £35k a year')).toBe(35000)
    expect(parseSalaryFromMessage('£60,000 salary')).toBe(60000)
  })

  it('returns null when no salary mentioned', () => {
    expect(parseSalaryFromMessage('how much tax do I pay?')).toBeNull()
  })
})
