/**
 * Cash flow forecast service.
 *
 * Predicts whether the user's current balance will cover all upcoming
 * committed payments (recurring subscriptions + detected bills) before
 * their next estimated payday.
 *
 * Returns:
 *   - currentBalance: sum of active account balances
 *   - upcomingCommitted: estimated total bills/DDs due before next payday
 *   - projectedBalance: currentBalance - upcomingCommitted
 *   - daysUntilPayday: estimated days until next salary credit
 *   - isShortfall: true if projectedBalance < 0
 *   - shortfallAmount: magnitude of projected negative balance (0 if none)
 */
import type { PrismaClient } from '@prisma/client'

export interface CashFlowForecast {
  currentBalance: number
  upcomingCommitted: number
  projectedBalance: number
  daysUntilPayday: number | null
  nextPayday: Date | null
  isShortfall: boolean
  shortfallAmount: number
  recurringCount: number
}

export async function getCashFlowForecast(
  prisma: PrismaClient,
  userId: string,
): Promise<CashFlowForecast> {
  const now = new Date()

  // ── Current balance ───────────────────────────────────────────────────────
  const accounts = await prisma.account.aggregate({
    where: { userId, isActive: true },
    _sum: { currentBalance: true },
  })
  const currentBalance = Number(accounts._sum.currentBalance ?? 0)

  // ── Next payday estimate ──────────────────────────────────────────────────
  const lastSalary = await prisma.transaction.findFirst({
    where: { userId, isSalary: true, amount: { gt: 0 } },
    orderBy: { transactionDate: 'desc' },
    select: { transactionDate: true },
  })

  let nextPayday: Date | null = null
  let daysUntilPayday: number | null = null

  if (lastSalary) {
    const last = lastSalary.transactionDate
    // Estimate next payday: same day-of-month, next month
    const candidate = new Date(last.getFullYear(), last.getMonth() + 1, last.getDate())
    // If that date is in the past (e.g., we're already past it), push forward another month
    if (candidate <= now) {
      nextPayday = new Date(last.getFullYear(), last.getMonth() + 2, last.getDate())
    } else {
      nextPayday = candidate
    }
    daysUntilPayday = Math.ceil((nextPayday.getTime() - now.getTime()) / 86_400_000)
  }

  // ── Upcoming committed payments ───────────────────────────────────────────
  // Use active recurring payments as a proxy for bills/DDs due before payday.
  // Filter to those whose average amount is negative (outgoings).
  const recurring = await prisma.recurringPayment.findMany({
    where: { userId, isActive: true, averageAmount: { lt: 0 } },
    select: { averageAmount: true, merchantName: true },
  })

  // If we know next payday, prorate monthly amounts by days remaining
  // Otherwise assume the full monthly committed total
  let upcomingCommitted: number
  if (daysUntilPayday !== null && daysUntilPayday > 0) {
    // Each recurring payment is monthly; scale by fraction of month remaining
    const fractionOfMonth = Math.min(daysUntilPayday / 30, 1)
    upcomingCommitted = recurring.reduce((sum, r) => sum + Math.abs(Number(r.averageAmount)) * fractionOfMonth, 0)
  } else {
    upcomingCommitted = recurring.reduce((sum, r) => sum + Math.abs(Number(r.averageAmount)), 0)
  }

  const projectedBalance = currentBalance - upcomingCommitted
  const isShortfall = projectedBalance < 0
  const shortfallAmount = isShortfall ? Math.abs(projectedBalance) : 0

  return {
    currentBalance,
    upcomingCommitted,
    projectedBalance,
    daysUntilPayday,
    nextPayday,
    isShortfall,
    shortfallAmount,
    recurringCount: recurring.length,
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function formatCashFlowForecast(forecast: CashFlowForecast): string {
  const { currentBalance, upcomingCommitted, projectedBalance, daysUntilPayday, isShortfall, shortfallAmount, recurringCount } = forecast

  let out = `💸 *Cash flow forecast*\n\n`
  out += `Current balance: *${fmt(currentBalance)}*\n`

  if (daysUntilPayday !== null) {
    out += `Next payday: *${daysUntilPayday} day${daysUntilPayday === 1 ? '' : 's'}* away\n`
  }

  if (recurringCount > 0) {
    out += `Committed payments: *${fmt(upcomingCommitted)}* (${recurringCount} recurring)\n`
  }

  const label = daysUntilPayday !== null ? 'before payday' : 'after committed payments'
  out += `\nProjected balance ${label}: *${projectedBalance >= 0 ? '' : '-'}${fmt(projectedBalance)}*\n\n`

  if (isShortfall) {
    out += `⚠️ *Potential shortfall of ${fmt(shortfallAmount)}* — you may need to reduce spending or transfer funds before your next payday.\n\n`
  } else {
    out += `✅ You look comfortable — your balance should cover your committed payments.\n\n`
  }

  out += `_Estimates based on recurring payments detected in your account. Actual amounts may vary._`

  return out
}
