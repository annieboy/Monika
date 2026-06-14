/**
 * Net worth calculation.
 *
 * Assets:  sum of positive balances across all active bank accounts
 * Liabilities: estimated from recurring payments that look like debt
 *              (mortgage, loan, credit card) multiplied by remaining term
 *
 * This is an estimate, not an exact figure — we only see what flows through
 * connected bank accounts. We label it clearly as an estimate.
 */
import type { PrismaClient } from '@prisma/client'

export interface NetWorthBreakdown {
  totalAssets: number
  estimatedLiabilities: number
  netWorth: number
  accounts: Array<{ name: string; balance: number }>
  debtPayments: Array<{ name: string; monthlyPayment: number }>
}

const DEBT_KEYWORDS = /mortgage|loan|credit\s+card|finance|hp\s+payment|car\s+finance|student\s+loan/i

export async function calculateNetWorth(
  prisma: PrismaClient,
  userId: string,
): Promise<NetWorthBreakdown> {
  // Assets: current balances from all active bank connections
  const connections = await prisma.bankConnection.findMany({
    where: { userId, consentStatus: 'active' },
    include: {
      accounts: {
        where: { deletedAt: null },
        select: { displayName: true, balance: true, accountType: true },
      },
    },
  })

  const accounts: Array<{ name: string; balance: number }> = []
  let totalAssets = 0

  for (const conn of connections) {
    for (const acct of conn.accounts) {
      const bal = Number(acct.balance ?? 0)
      accounts.push({ name: acct.displayName ?? acct.accountType ?? 'Account', balance: bal })
      if (bal > 0) totalAssets += bal
    }
  }

  // Liabilities: recurring payments that look like debt servicing
  const recurringPayments = await prisma.recurringPayment.findMany({
    where: { userId, isActive: true },
    select: { merchantName: true, amount: true },
  })

  const debtPayments: Array<{ name: string; monthlyPayment: number }> = []
  let estimatedLiabilities = 0

  for (const payment of recurringPayments) {
    if (DEBT_KEYWORDS.test(payment.merchantName ?? '')) {
      const monthly = Math.abs(Number(payment.amount))
      debtPayments.push({ name: payment.merchantName ?? 'Debt payment', monthlyPayment: monthly })
      // Rough outstanding estimate: 12 months of remaining payments (conservative)
      estimatedLiabilities += monthly * 12
    }
  }

  return {
    totalAssets,
    estimatedLiabilities,
    netWorth: totalAssets - estimatedLiabilities,
    accounts,
    debtPayments,
  }
}

const fmt = (n: number) =>
  `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export function formatNetWorth(breakdown: NetWorthBreakdown): string {
  const sign = breakdown.netWorth >= 0 ? '' : '-'
  const netWorthStr = `${sign}${fmt(breakdown.netWorth)}`

  let out = `💰 *Your estimated net worth: ${netWorthStr}*\n\n`

  out += `*Assets*\n`
  for (const acct of breakdown.accounts) {
    const bal = acct.balance >= 0 ? `+${fmt(acct.balance)}` : `-${fmt(acct.balance)}`
    out += `  ${acct.name}: ${bal}\n`
  }
  out += `  *Total: +${fmt(breakdown.totalAssets)}*\n\n`

  if (breakdown.debtPayments.length > 0) {
    out += `*Estimated liabilities* _(based on recurring debt payments × 12)_\n`
    for (const d of breakdown.debtPayments) {
      out += `  ${d.name}: ~${fmt(d.monthlyPayment * 12)}\n`
    }
    out += `  *Total: -${fmt(breakdown.estimatedLiabilities)}*\n\n`
  }

  out += `_This is an estimate based on your connected accounts. Actual figures may differ._`
  return out
}
