/**
 * Category deep-dive service.
 *
 * Given a category name, returns a detailed breakdown for the current month:
 *   - Total spend
 *   - Number of transactions
 *   - Top merchants within the category
 *   - Daily average spend
 *   - Comparison vs last month
 *   - Individual transactions (most recent first, up to 20)
 */
import type { PrismaClient } from '@prisma/client'

export interface CategoryDeepDive {
  category: string
  thisMonth: number
  lastMonth: number
  changeAmt: number
  changePct: number | null
  transactionCount: number
  dailyAverage: number
  topMerchants: Array<{ merchant: string; total: number; count: number }>
  recentTransactions: Array<{
    id: string
    date: Date
    merchant: string | null
    amount: number
    description: string | null
  }>
}

export async function getCategoryDeepDive(
  prisma: PrismaClient,
  userId: string,
  category: string,
  now = new Date(),
): Promise<CategoryDeepDive> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  const baseWhere = {
    userId,
    amount: { lt: 0 },
    category: { contains: category, mode: 'insensitive' as const },
  }

  const [thisMonthAgg, lastMonthAgg, transactions, merchantRows] = await Promise.all([
    prisma.transaction.aggregate({
      where: { ...baseWhere, transactionDate: { gte: monthStart, lte: now } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.transaction.aggregate({
      where: { ...baseWhere, transactionDate: { gte: lastMonthStart, lte: lastMonthEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { ...baseWhere, transactionDate: { gte: monthStart, lte: now } },
      orderBy: { transactionDate: 'desc' },
      take: 20,
      select: {
        id: true,
        transactionDate: true,
        merchantNameClean: true,
        merchantName: true,
        amount: true,
        cleanDescription: true,
        rawDescription: true,
      },
    }),
    prisma.transaction.groupBy({
      by: ['merchantNameClean'],
      where: { ...baseWhere, transactionDate: { gte: monthStart, lte: now } },
      _sum: { amount: true },
      _count: { id: true },
      orderBy: { _sum: { amount: 'asc' } },
      take: 5,
    }),
  ])

  const thisMonth = Math.abs(Number(thisMonthAgg._sum.amount ?? 0))
  const lastMonth = Math.abs(Number(lastMonthAgg._sum.amount ?? 0))
  const changeAmt = thisMonth - lastMonth
  const changePct = lastMonth > 0 ? changeAmt / lastMonth : null
  const transactionCount = thisMonthAgg._count.id

  const daysElapsed = Math.max(1, now.getDate())
  const dailyAverage = thisMonth / daysElapsed

  const topMerchants = merchantRows
    .filter(r => r.merchantNameClean)
    .map(r => ({
      merchant: r.merchantNameClean!,
      total: Math.abs(Number(r._sum.amount ?? 0)),
      count: r._count.id,
    }))

  const recentTransactions = transactions.map(r => ({
    id: r.id,
    date: r.transactionDate,
    merchant: r.merchantNameClean ?? r.merchantName ?? null,
    amount: Math.abs(Number(r.amount)),
    description: r.cleanDescription ?? r.rawDescription ?? null,
  }))

  return {
    category,
    thisMonth,
    lastMonth,
    changeAmt,
    changePct,
    transactionCount,
    dailyAverage,
    topMerchants,
    recentTransactions,
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function formatCategoryDeepDive(dive: CategoryDeepDive): string {
  const changeIcon = dive.changeAmt > 0 ? '📈' : dive.changeAmt < 0 ? '📉' : '→'
  const changePctStr = dive.changePct !== null
    ? ` (${dive.changePct >= 0 ? '+' : ''}${Math.round(dive.changePct * 100)}% vs last month)`
    : ''

  let out = `🔍 *${dive.category} — this month*\n\n`
  out += `Total: *${fmt(dive.thisMonth)}* ${changeIcon}${changePctStr}\n`
  out += `Last month: *${fmt(dive.lastMonth)}*\n`
  out += `Daily average: *${fmt(dive.dailyAverage)}/day*\n`
  out += `Transactions: *${dive.transactionCount}*\n`

  if (dive.topMerchants.length > 0) {
    out += `\n*Top merchants:*\n`
    for (const m of dive.topMerchants) {
      out += `  • ${m.merchant}: ${fmt(m.total)} (${m.count}x)\n`
    }
  }

  if (dive.recentTransactions.length > 0) {
    out += `\n*Recent transactions:*\n`
    for (const tx of dive.recentTransactions.slice(0, 8)) {
      const label = tx.merchant ?? tx.description ?? 'Unknown'
      out += `  • ${fmtDate(tx.date)} — ${label}: ${fmt(tx.amount)}\n`
    }
    if (dive.recentTransactions.length > 8) {
      out += `  _…and ${dive.recentTransactions.length - 8} more_\n`
    }
  }

  return out.trim()
}
