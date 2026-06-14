/**
 * Merchant insight service.
 *
 * For a given merchant name, returns enriched historical stats:
 *   - Total spend (lifetime in account data)
 *   - Visit count (number of transactions)
 *   - Average spend per visit
 *   - First and last transaction dates
 *   - Monthly average spend
 *   - Trend: is spending increasing or decreasing vs prior 3 months?
 */
import type { PrismaClient } from '@prisma/client'

export interface MerchantInsight {
  merchant: string
  totalSpend: number
  visitCount: number
  averagePerVisit: number
  firstSeen: Date | null
  lastSeen: Date | null
  monthlyAverage: number
  recentMonthSpend: number        // last 30 days
  priorMonthSpend: number         // 30-60 days ago
  trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data'
}

const TREND_THRESHOLD = 0.2  // 20% change = trending

export async function getMerchantInsight(
  prisma: PrismaClient,
  userId: string,
  merchantName: string,
): Promise<MerchantInsight | null> {
  const merchantFilter = {
    userId,
    amount: { lt: 0 },
    OR: [
      { merchantNameClean: { contains: merchantName, mode: 'insensitive' as const } },
      { merchantName: { contains: merchantName, mode: 'insensitive' as const } },
      { cleanDescription: { contains: merchantName, mode: 'insensitive' as const } },
    ],
  }

  // All-time aggregate
  const agg = await prisma.transaction.aggregate({
    where: merchantFilter,
    _sum: { amount: true },
    _count: { id: true },
    _min: { transactionDate: true },
    _max: { transactionDate: true },
  })

  const visitCount = agg._count.id
  if (visitCount === 0) return null

  const totalSpend = Math.abs(Number(agg._sum.amount ?? 0))
  const firstSeen = agg._min.transactionDate ?? null
  const lastSeen = agg._max.transactionDate ?? null

  // Monthly average: total / months of history
  let monthlyAverage = 0
  if (firstSeen && lastSeen) {
    const months = Math.max(
      1,
      (lastSeen.getTime() - firstSeen.getTime()) / (30 * 86_400_000),
    )
    monthlyAverage = totalSpend / months
  }

  // Recent vs prior 30-day spend (for trend)
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000)
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000)

  const [recentAgg, priorAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { ...merchantFilter, transactionDate: { gte: thirtyDaysAgo } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { ...merchantFilter, transactionDate: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      _sum: { amount: true },
    }),
  ])

  const recentMonthSpend = Math.abs(Number(recentAgg._sum.amount ?? 0))
  const priorMonthSpend = Math.abs(Number(priorAgg._sum.amount ?? 0))

  let trend: MerchantInsight['trend'] = 'insufficient_data'
  if (recentMonthSpend > 0 && priorMonthSpend > 0) {
    const change = (recentMonthSpend - priorMonthSpend) / priorMonthSpend
    if (change > TREND_THRESHOLD) trend = 'increasing'
    else if (change < -TREND_THRESHOLD) trend = 'decreasing'
    else trend = 'stable'
  }

  return {
    merchant: merchantName,
    totalSpend,
    visitCount,
    averagePerVisit: visitCount > 0 ? totalSpend / visitCount : 0,
    firstSeen,
    lastSeen,
    monthlyAverage,
    recentMonthSpend,
    priorMonthSpend,
    trend,
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

const TREND_LABELS: Record<MerchantInsight['trend'], string> = {
  increasing: '📈 Spending increasing vs last month',
  decreasing: '📉 Spending decreasing vs last month',
  stable: '→ Spending stable vs last month',
  insufficient_data: '',
}

export function formatMerchantInsight(insight: MerchantInsight): string {
  let out = `🏪 *${insight.merchant} — Spending Insights*\n\n`
  out += `Total spent: *${fmt(insight.totalSpend)}*\n`
  out += `Visits: *${insight.visitCount}*\n`
  out += `Average per visit: *${fmt(insight.averagePerVisit)}*\n`
  out += `Monthly average: *${fmt(insight.monthlyAverage)}*\n`

  if (insight.firstSeen) out += `First visit: ${fmtDate(insight.firstSeen)}\n`
  if (insight.lastSeen) out += `Last visit: ${fmtDate(insight.lastSeen)}\n`

  if (insight.trend !== 'insufficient_data') {
    out += `\n${TREND_LABELS[insight.trend]}\n`
    out += `Last 30 days: ${fmt(insight.recentMonthSpend)} vs prior 30 days: ${fmt(insight.priorMonthSpend)}\n`
  }

  return out.trim()
}
