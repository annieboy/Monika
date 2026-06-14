/**
 * Monthly aggregation service.
 *
 * Nightly job that pre-computes MonthlySummary records per user per calendar month.
 * Pre-computing these makes spending queries O(1) instead of scanning all transactions.
 *
 * Computes the current month and the previous month on each run so that:
 *   - The current month stays fresh as transactions arrive during the day
 *   - The prior month gets finalised once the month closes
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import { logger } from '../../logger.js'

export interface AggregationResult {
  aggregated: number
  errors: number
}

/** Format a Date as 'YYYY-MM'. */
function toYearMonth(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Start of month at UTC midnight. */
function startOfMonth(yearMonth: string): Date {
  return new Date(`${yearMonth}-01T00:00:00.000Z`)
}

/** Exclusive end of month (= start of next month). */
function endOfMonth(yearMonth: string): Date {
  const [y, m] = yearMonth.split('-').map(Number) as [number, number]
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return new Date(`${next}-01T00:00:00.000Z`)
}

async function aggregateUserMonth(
  prisma: PrismaClient,
  userId: string,
  yearMonth: string,
): Promise<void> {
  const since = startOfMonth(yearMonth)
  const until = endOfMonth(yearMonth)

  // Aggregate totals in one pass
  const [debitAgg, creditAgg, count] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, transactionDate: { gte: since, lt: until }, amount: { lt: 0 } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, transactionDate: { gte: since, lt: until }, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.transaction.count({
      where: { userId, transactionDate: { gte: since, lt: until } },
    }),
  ])

  const totalSpend = Math.abs(Number(debitAgg._sum.amount ?? 0))
  const totalIncome = Number(creditAgg._sum.amount ?? 0)
  const net = totalIncome - totalSpend

  // Per-category spend breakdown
  const categoryRows = await prisma.transaction.groupBy({
    by: ['category'],
    where: {
      userId,
      transactionDate: { gte: since, lt: until },
      amount: { lt: 0 },
      category: { not: null },
    },
    _sum: { amount: true },
  })

  const spendByCategory: Record<string, number> = {}
  for (const row of categoryRows) {
    if (row.category) {
      spendByCategory[row.category] = Math.abs(Number(row._sum.amount ?? 0))
    }
  }

  await prisma.monthlySummary.upsert({
    where: { userId_yearMonth: { userId, yearMonth } },
    create: {
      userId,
      yearMonth,
      totalSpend,
      totalIncome,
      net,
      spendByCategory: spendByCategory as Prisma.InputJsonValue,
      transactionCount: count,
      computedAt: new Date(),
    },
    update: {
      totalSpend,
      totalIncome,
      net,
      spendByCategory: spendByCategory as Prisma.InputJsonValue,
      transactionCount: count,
      computedAt: new Date(),
    },
  })
}

/**
 * Runs the monthly aggregation batch for all active users.
 * Computes the current and prior calendar month.
 */
export async function runMonthlyAggregationBatch(
  prisma: PrismaClient,
): Promise<AggregationResult> {
  const now = new Date()
  const currentMonth = toYearMonth(now)
  // Prior month
  const priorDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
  const priorMonth = toYearMonth(priorDate)

  const users = await prisma.user.findMany({
    where: { bankConnections: { some: { consentStatus: 'active' } } },
    select: { id: true },
  })

  let aggregated = 0
  let errors = 0

  for (const { id: userId } of users) {
    try {
      await Promise.all([
        aggregateUserMonth(prisma, userId, currentMonth),
        aggregateUserMonth(prisma, userId, priorMonth),
      ])
      aggregated++
    } catch (err) {
      errors++
      logger.error({ err, userId, currentMonth }, 'Monthly aggregation failed for user')
    }
  }

  logger.info({ aggregated, errors, currentMonth, priorMonth }, 'Monthly aggregation batch complete')
  return { aggregated, errors }
}
