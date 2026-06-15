import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { getEmergencyFundStatus, isEmergencyFundRequest } from '../emergencyFundService.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

function makePrisma(opts: {
  spending?: Array<{ category: string | null; _sum: { amount: Decimal | null } }>
  balance?: number
} = {}): PrismaClient {
  const { spending = [], balance = 3000 } = opts
  return {
    transaction: {
      groupBy: vi.fn().mockResolvedValue(spending),
    },
    account: {
      findMany: vi.fn().mockResolvedValue([{ currentBalance: new Decimal(balance), accountType: 'CURRENT' }]),
    },
  } as unknown as PrismaClient
}

describe('getEmergencyFundStatus', () => {
  it('returns data-needed message when no spending data', async () => {
    const prisma = makePrisma({ spending: [] })
    const result = await getEmergencyFundStatus(prisma, 'user-1')
    expect(result).toMatch(/data|connect/i)
  })

  it('marks fund as excellent when coverage >= 6 months', async () => {
    // £500/month essentials, £4500 balance = 9 months
    const prisma = makePrisma({
      spending: [{ category: 'groceries', _sum: { amount: new Decimal(1500) } }],
      balance: 4500,
    })
    const result = await getEmergencyFundStatus(prisma, 'user-1')
    expect(result).toMatch(/excellent/i)
  })

  it('marks fund as good when coverage is 3-6 months', async () => {
    // £500/month essentials, £1800 balance = 3.6 months
    const prisma = makePrisma({
      spending: [{ category: 'groceries', _sum: { amount: new Decimal(1500) } }],
      balance: 1800,
    })
    const result = await getEmergencyFundStatus(prisma, 'user-1')
    expect(result).toMatch(/good/i)
  })

  it('warns when coverage < 3 months', async () => {
    // £500/month essentials, £900 balance = 1.8 months
    const prisma = makePrisma({
      spending: [{ category: 'rent', _sum: { amount: new Decimal(1500) } }],
      balance: 900,
    })
    const result = await getEmergencyFundStatus(prisma, 'user-1')
    expect(result).toMatch(/action needed|⚠️/i)
  })

  it('ignores non-essential categories', async () => {
    // Entertainment + essentials — only essentials count
    const prisma = makePrisma({
      spending: [
        { category: 'entertainment', _sum: { amount: new Decimal(300) } },
        { category: 'groceries', _sum: { amount: new Decimal(600) } },
      ],
      balance: 600,
    })
    const result = await getEmergencyFundStatus(prisma, 'user-1')
    // £200/month essentials, £600 balance = 3 months
    expect(result).toMatch(/3\.0\s*months|good/i)
  })
})

describe('isEmergencyFundRequest', () => {
  it('matches emergency fund queries', () => {
    expect(isEmergencyFundRequest('do I have an emergency fund?')).toBe(true)
    expect(isEmergencyFundRequest('check my rainy day fund')).toBe(true)
    expect(isEmergencyFundRequest('how many months of savings do I have?')).toBe(true)
    expect(isEmergencyFundRequest('financial cushion')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isEmergencyFundRequest('how much did I spend on food?')).toBe(false)
    expect(isEmergencyFundRequest('what is my balance?')).toBe(false)
  })
})
