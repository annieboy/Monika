/**
 * End-of-month spending forecast.
 *
 * Uses the current day-of-month spend rate to project what the user will
 * spend by month end. Compares against last month and any active budget.
 *
 * Algorithm:
 *   dailyRate = thisMonthSpend / daysElapsed
 *   forecast  = dailyRate * daysInMonth
 *
 * This is intentionally simple — no ML, no seasonality adjustment.
 * It's honest about uncertainty and clearly labelled as a projection.
 */
import type { PrismaClient } from '@prisma/client'

export interface SpendingForecast {
  thisMonthSoFar: number
  forecastedTotal: number
  lastMonthTotal: number
  changeVsLastMonth: number      // positive = forecasting more spend
  daysElapsed: number
  daysInMonth: number
  dailyRate: number
}

export async function getSpendingForecast(
  prisma: PrismaClient,
  userId: string,
): Promise<SpendingForecast> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  const thisMonthStart = new Date(year, month, 1)
  const lastMonthStart = new Date(year, month - 1, 1)
  const lastMonthEnd = new Date(year, month, 0, 23, 59, 59, 999)

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysElapsed = Math.max(1, now.getDate())

  // This month spend so far
  const thisMonthAgg = await prisma.transaction.aggregate({
    where: {
      userId,
      transactionDate: { gte: thisMonthStart, lte: now },
      amount: { lt: 0 },
    },
    _sum: { amount: true },
  })

  // Last month total spend
  const lastMonthAgg = await prisma.transaction.aggregate({
    where: {
      userId,
      transactionDate: { gte: lastMonthStart, lte: lastMonthEnd },
      amount: { lt: 0 },
    },
    _sum: { amount: true },
  })

  const thisMonthSoFar = Math.abs(Number(thisMonthAgg._sum.amount ?? 0))
  const lastMonthTotal = Math.abs(Number(lastMonthAgg._sum.amount ?? 0))
  const dailyRate = thisMonthSoFar / daysElapsed
  const forecastedTotal = dailyRate * daysInMonth

  return {
    thisMonthSoFar,
    forecastedTotal,
    lastMonthTotal,
    changeVsLastMonth: forecastedTotal - lastMonthTotal,
    daysElapsed,
    daysInMonth,
    dailyRate,
  }
}

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export function formatSpendingForecast(forecast: SpendingForecast): string {
  const daysLeft = forecast.daysInMonth - forecast.daysElapsed
  const pctElapsed = Math.round((forecast.daysElapsed / forecast.daysInMonth) * 100)
  const trend = forecast.changeVsLastMonth >= 0 ? 'up' : 'down'
  const trendPct = forecast.lastMonthTotal > 0
    ? Math.abs(Math.round((forecast.changeVsLastMonth / forecast.lastMonthTotal) * 100))
    : null

  let out = `📅 *Spending forecast for this month*\n\n`
  out += `We're ${pctElapsed}% through ${new Date().toLocaleString('en-GB', { month: 'long' })} (${daysLeft} days to go).\n\n`
  out += `*So far:* ${fmt(forecast.thisMonthSoFar)} at ${fmt(forecast.dailyRate)}/day\n`
  out += `*Projected total:* ~${fmt(forecast.forecastedTotal)}\n`
  if (forecast.lastMonthTotal > 0) {
    out += `*Last month:* ${fmt(forecast.lastMonthTotal)}`
    if (trendPct !== null) {
      out += ` _(${trend} ${trendPct}%)_`
    }
    out += `\n`
  }
  out += `\n_Based on your daily average so far — actual spend may vary._`
  return out
}
