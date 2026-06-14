import { describe, it, expect } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { calculateNetWorth, formatNetWorth } from '../netWorthService.js'

function makePrisma(opts: {
  accounts?: Array<{ displayName: string; balance: number; accountType?: string }>
  recurringPayments?: Array<{ merchantName: string; amount: number }>
} = {}) {
  const accounts = (opts.accounts ?? []).map(a => ({
    displayName: a.displayName,
    currentBalance: a.balance,
    accountType: a.accountType ?? 'current',
  }))

  const recurringPayments = (opts.recurringPayments ?? []).map(r => ({
    merchantName: r.merchantName,
    averageAmount: r.amount,
  }))

  return {
    account: {
      findMany: () => Promise.resolve(accounts),
    },
    recurringPayment: {
      findMany: () => Promise.resolve(recurringPayments),
    },
  } as unknown as PrismaClient
}

describe('calculateNetWorth', () => {
  it('sums positive balances as assets', async () => {
    const prisma = makePrisma({
      accounts: [
        { displayName: 'Current', balance: 1500 },
        { displayName: 'Savings', balance: 3000 },
      ],
    })
    const result = await calculateNetWorth(prisma, 'user-1')
    expect(result.totalAssets).toBe(4500)
    expect(result.netWorth).toBe(4500)
  })

  it('excludes negative balances from assets', async () => {
    const prisma = makePrisma({
      accounts: [
        { displayName: 'Current', balance: 1000 },
        { displayName: 'Overdraft', balance: -200 },
      ],
    })
    const result = await calculateNetWorth(prisma, 'user-1')
    expect(result.totalAssets).toBe(1000)
  })

  it('detects mortgage as liability and estimates outstanding', async () => {
    const prisma = makePrisma({
      accounts: [{ displayName: 'Current', balance: 5000 }],
      recurringPayments: [{ merchantName: 'Halifax Mortgage', amount: -800 }],
    })
    const result = await calculateNetWorth(prisma, 'user-1')
    expect(result.estimatedLiabilities).toBe(800 * 12)
    expect(result.debtPayments).toHaveLength(1)
    expect(result.netWorth).toBe(5000 - 800 * 12)
  })

  it('ignores non-debt recurring payments', async () => {
    const prisma = makePrisma({
      accounts: [{ displayName: 'Current', balance: 2000 }],
      recurringPayments: [{ merchantName: 'Netflix', amount: -15 }],
    })
    const result = await calculateNetWorth(prisma, 'user-1')
    expect(result.estimatedLiabilities).toBe(0)
    expect(result.debtPayments).toHaveLength(0)
  })

  it('returns zero net worth when no accounts', async () => {
    const prisma = makePrisma()
    const result = await calculateNetWorth(prisma, 'user-1')
    expect(result.totalAssets).toBe(0)
    expect(result.netWorth).toBe(0)
    expect(result.accounts).toHaveLength(0)
  })
})

describe('formatNetWorth', () => {
  it('includes net worth figure', () => {
    const out = formatNetWorth({
      totalAssets: 10000,
      estimatedLiabilities: 2400,
      netWorth: 7600,
      accounts: [{ name: 'Current', balance: 10000 }],
      debtPayments: [{ name: 'Car loan', monthlyPayment: 200 }],
    })
    expect(out).toMatch(/£7,600/)
    expect(out).toMatch(/Assets/i)
    expect(out).toMatch(/liabilities/i)
    expect(out).toMatch(/estimate/i)
  })

  it('shows negative net worth with minus sign', () => {
    const out = formatNetWorth({
      totalAssets: 500,
      estimatedLiabilities: 9600,
      netWorth: -9100,
      accounts: [{ name: 'Current', balance: 500 }],
      debtPayments: [{ name: 'Mortgage', monthlyPayment: 800 }],
    })
    expect(out).toMatch(/-£9,100/)
  })

  it('omits liabilities section when there are none', () => {
    const out = formatNetWorth({
      totalAssets: 5000,
      estimatedLiabilities: 0,
      netWorth: 5000,
      accounts: [{ name: 'Savings', balance: 5000 }],
      debtPayments: [],
    })
    expect(out).not.toMatch(/liabilities/i)
  })
})
