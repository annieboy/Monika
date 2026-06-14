/**
 * Spending trend detection.
 *
 * Compares spending in the current month vs the trailing 3-month average.
 * Categories with >20% increase are flagged as 'rising'.
 * Categories with >20% decrease are flagged as 'falling'.
 *
 * Used for:
 *   1. Proactive alerts (scheduled monthly) — notifies users about rising spend
 *   2. The 'spending_trends' intent — responds to "how is my spending trending?"
 */
import type { PrismaClient } from '@prisma/client'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { decrypt } from '../../lib/crypto.js'
import { logger } from '../../logger.js'

const RISING_THRESHOLD = 0.20   // 20% above 3-month average
const FALLING_THRESHOLD = 0.20  // 20% below 3-month average
const MIN_MONTHLY_SPEND = 10    // ignore tiny categories (noise)

export interface CategoryTrend {
  category: string
  thisMonth: number
  avgLast3Months: number
  changePct: number           // positive = higher than average
  direction: 'rising' | 'falling' | 'stable'
}

export interface SpendingTrendResult {
  trends: CategoryTrend[]
  rising: CategoryTrend[]
  falling: CategoryTrend[]
}

// ── Core calculation ──────────────────────────────────────────────────────────

export async function getSpendingTrends(
  prisma: PrismaClient,
  userId: string,
): Promise<SpendingTrendResult> {
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // 3-month window (excluding current month)
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  // Current month spend by category
  const thisMonthRows = await prisma.transaction.groupBy({
    by: ['category'],
    where: {
      userId,
      transactionDate: { gte: thisMonthStart, lte: now },
      amount: { lt: 0 },
      category: { not: null },
    },
    _sum: { amount: true },
  })

  // Last 3 months spend by category
  const last3MonthsRows = await prisma.transaction.groupBy({
    by: ['category'],
    where: {
      userId,
      transactionDate: { gte: threeMonthsAgo, lte: lastMonthEnd },
      amount: { lt: 0 },
      category: { not: null },
    },
    _sum: { amount: true },
  })

  // Build lookup: category → 3-month average
  const avg3m = new Map<string, number>()
  for (const row of last3MonthsRows) {
    if (row.category) {
      avg3m.set(row.category, Math.abs(Number(row._sum.amount ?? 0)) / 3)
    }
  }

  const trends: CategoryTrend[] = []

  for (const row of thisMonthRows) {
    if (!row.category) continue
    const thisMonth = Math.abs(Number(row._sum.amount ?? 0))
    if (thisMonth < MIN_MONTHLY_SPEND) continue

    const avg = avg3m.get(row.category) ?? 0
    if (avg < MIN_MONTHLY_SPEND) continue

    const changePct = (thisMonth - avg) / avg
    const direction: CategoryTrend['direction'] =
      changePct > RISING_THRESHOLD ? 'rising' :
      changePct < -FALLING_THRESHOLD ? 'falling' : 'stable'

    trends.push({ category: row.category, thisMonth, avgLast3Months: avg, changePct, direction })
  }

  // Sort by absolute change percentage descending
  trends.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))

  return {
    trends,
    rising: trends.filter(t => t.direction === 'rising'),
    falling: trends.filter(t => t.direction === 'falling'),
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export function formatSpendingTrends(result: SpendingTrendResult): string {
  if (result.trends.length === 0) {
    return `I don't have enough data yet to show spending trends — I need at least 3 months of transaction history.`
  }

  let out = `📈 *Your spending trends this month:*\n\n`

  if (result.rising.length > 0) {
    out += `*↑ Rising spend*\n`
    for (const t of result.rising.slice(0, 3)) {
      const pct = Math.round(t.changePct * 100)
      out += `• *${t.category}*: ${fmt(t.thisMonth)} (+${pct}% vs avg ${fmt(t.avgLast3Months)}/month)\n`
    }
    out += `\n`
  }

  if (result.falling.length > 0) {
    out += `*↓ Falling spend*\n`
    for (const t of result.falling.slice(0, 3)) {
      const pct = Math.round(Math.abs(t.changePct) * 100)
      out += `• *${t.category}*: ${fmt(t.thisMonth)} (-${pct}% vs avg ${fmt(t.avgLast3Months)}/month)\n`
    }
    out += `\n`
  }

  const stable = result.trends.filter(t => t.direction === 'stable')
  if (stable.length > 0 && result.rising.length === 0 && result.falling.length === 0) {
    out += `Everything looks consistent with your 3-month average. 👍\n`
  }

  return out.trim()
}

// ── Proactive alert batch ─────────────────────────────────────────────────────

export interface TrendAlertResult {
  notified: number
  errors: number
}

const ALERT_RATE_LIMIT_DAYS = 25

async function wasAlertedRecently(prisma: PrismaClient, userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - ALERT_RATE_LIMIT_DAYS * 86_400_000)
  const hit = await prisma.auditLog.findFirst({
    where: { userId, eventType: 'spending_trend_alert_sent', createdAt: { gt: cutoff } },
    select: { id: true },
  })
  return !!hit
}

async function getPhone(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappPhoneEnc: true },
  })
  if (!user?.whatsappPhoneEnc) return null
  return decrypt(Buffer.from(user.whatsappPhoneEnc), config.ENCRYPTION_KEY).toString('utf-8')
}

export async function runSpendingTrendAlertBatch(prisma: PrismaClient): Promise<TrendAlertResult> {
  const activeUsers = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active' },
    distinct: ['userId'],
    select: { userId: true },
  })

  let notified = 0
  let errors = 0

  for (const { userId } of activeUsers) {
    try {
      if (await wasAlertedRecently(prisma, userId)) continue

      const result = await getSpendingTrends(prisma, userId)
      if (result.rising.length === 0) continue

      const phone = await getPhone(prisma, userId)
      if (!phone) continue

      const top = result.rising.slice(0, 2)
      let msg = `📊 *Monthly spending check-in*\n\n`
      msg += `Your spending is up in ${result.rising.length === 1 ? 'one category' : `${result.rising.length} categories`} compared to your 3-month average:\n\n`
      for (const t of top) {
        msg += `• *${t.category}*: ${fmt(t.thisMonth)} this month (+${Math.round(t.changePct * 100)}%)\n`
      }
      if (result.rising.length > 2) {
        msg += `• …and ${result.rising.length - 2} more\n`
      }
      msg += `\nSay *"how is my spending trending?"* for the full picture.`

      await sendWhatsAppMessage(phone, msg, config.WHATSAPP_PHONE_NUMBER_ID, config.WHATSAPP_ACCESS_TOKEN)
      await prisma.auditLog.create({
        data: {
          userId,
          eventType: 'spending_trend_alert_sent',
          eventData: { risingCategories: top.map(t => t.category) },
        },
      })
      notified++
    } catch (err) {
      errors++
      logger.error({ err, userId }, 'Spending trend alert failed')
    }
  }

  return { notified, errors }
}
