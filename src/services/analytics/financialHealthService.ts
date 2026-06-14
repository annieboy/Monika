/**
 * Financial health score.
 *
 * Produces a 0–100 score from five weighted components:
 *
 *   1. Savings rate         (30 pts) — % of income saved this month
 *   2. Budget adherence     (25 pts) — % of budgets not exceeded
 *   3. Balance buffer       (20 pts) — months of expenses covered by liquid balance
 *   4. Spending stability   (15 pts) — low variance month-over-month
 *   5. Subscription ratio   (10 pts) — subscriptions as % of income (lower is better)
 *
 * Scores in each band:
 *   80–100  Excellent  🟢
 *   60–79   Good       🔵
 *   40–59   Fair       🟡
 *   0–39    Needs work 🔴
 *
 * This is informational only, not financial advice.
 */
import type { PrismaClient } from '@prisma/client'

export interface HealthScoreBreakdown {
  total: number             // 0–100
  savingsRate: number       // 0–30
  budgetAdherence: number   // 0–25
  balanceBuffer: number     // 0–20
  spendingStability: number // 0–15
  subscriptionRatio: number // 0–10
  band: 'excellent' | 'good' | 'fair' | 'needs_work'
  inputs: {
    savingsRatePct: number | null
    budgetsSet: number
    budgetsExceeded: number
    monthsOfExpensesCovered: number
    spendChangePct: number | null
    subscriptionsPct: number | null
    monthlyIncome: number
  }
}

function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n))
}

function band(score: number): HealthScoreBreakdown['band'] {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'fair'
  return 'needs_work'
}

export async function getFinancialHealthScore(
  prisma: PrismaClient,
  userId: string,
): Promise<HealthScoreBreakdown> {
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  // ── Income ────────────────────────────────────────────────────────────────
  const incomeAgg = await prisma.transaction.aggregate({
    where: { userId, transactionDate: { gte: lastMonthStart, lte: lastMonthEnd }, isSalary: true, amount: { gt: 0 } },
    _sum: { amount: true },
  })
  const monthlyIncome = Number(incomeAgg._sum.amount ?? 0)

  // ── This month spend ──────────────────────────────────────────────────────
  const thisMonthAgg = await prisma.transaction.aggregate({
    where: { userId, transactionDate: { gte: thisMonthStart, lte: now }, amount: { lt: 0 } },
    _sum: { amount: true },
  })
  const thisMonthSpend = Math.abs(Number(thisMonthAgg._sum.amount ?? 0))

  // ── Last month spend ──────────────────────────────────────────────────────
  const lastMonthAgg = await prisma.transaction.aggregate({
    where: { userId, transactionDate: { gte: lastMonthStart, lte: lastMonthEnd }, amount: { lt: 0 } },
    _sum: { amount: true },
  })
  const lastMonthSpend = Math.abs(Number(lastMonthAgg._sum.amount ?? 0))

  // ── Balance ───────────────────────────────────────────────────────────────
  const balanceAgg = await prisma.account.aggregate({
    where: { userId, isActive: true },
    _sum: { currentBalance: true },
  })
  const totalBalance = Math.max(0, Number(balanceAgg._sum.currentBalance ?? 0))

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const subscriptions = await prisma.recurringPayment.findMany({
    where: { userId, isActive: true },
    select: { averageAmount: true },
  })
  const totalSubscriptions = subscriptions.reduce((s, r) => s + Math.abs(Number(r.averageAmount)), 0)

  // ── Budgets ───────────────────────────────────────────────────────────────
  const budgetRows = await prisma.auditLog.findMany({
    where: { userId, eventType: 'budget_set' },
    orderBy: { createdAt: 'desc' },
    select: { eventData: true },
  })

  // Deduplicate to latest per category
  const budgets = new Map<string, number>()
  for (const row of budgetRows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = row.eventData as any
    if (d?.category && d?.amount && !budgets.has(d.category)) {
      budgets.set(d.category, d.amount)
    }
  }

  let budgetsExceeded = 0
  const budgetsSet = budgets.size

  if (budgetsSet > 0) {
    const categorySpend = await prisma.transaction.groupBy({
      by: ['category'],
      where: {
        userId,
        transactionDate: { gte: thisMonthStart, lte: now },
        amount: { lt: 0 },
        category: { in: [...budgets.keys()] },
      },
      _sum: { amount: true },
    })

    for (const row of categorySpend) {
      if (!row.category) continue
      const budget = budgets.get(row.category) ?? 0
      const spent = Math.abs(Number(row._sum.amount ?? 0))
      if (spent > budget) budgetsExceeded++
    }
  }

  // ── Score calculation ─────────────────────────────────────────────────────

  // 1. Savings rate (0–30)
  const savingsRatePct = monthlyIncome > 0 ? (monthlyIncome - lastMonthSpend) / monthlyIncome : null
  const savingsScore = savingsRatePct !== null
    ? Math.round(clamp(savingsRatePct / 0.20) * 30)   // full score at 20%+ savings
    : 15                                                // no income data → neutral

  // 2. Budget adherence (0–25)
  const budgetScore = budgetsSet === 0
    ? 12                                                // no budgets set → partial credit
    : Math.round(clamp(1 - budgetsExceeded / budgetsSet) * 25)

  // 3. Balance buffer (0–20)
  const monthsOfExpensesCovered = lastMonthSpend > 0 ? totalBalance / lastMonthSpend : 0
  const balanceScore = Math.round(clamp(monthsOfExpensesCovered / 3) * 20) // full at 3 months

  // 4. Spending stability (0–15)
  const spendChangePct = lastMonthSpend > 0 ? (thisMonthSpend - lastMonthSpend) / lastMonthSpend : null
  const stabilityScore = spendChangePct !== null
    ? Math.round(clamp(1 - Math.min(1, Math.abs(spendChangePct) / 0.30)) * 15) // penalise >30% swings
    : 7                                                // neutral when no data

  // 5. Subscription ratio (0–10)
  const subscriptionsPct = monthlyIncome > 0 ? totalSubscriptions / monthlyIncome : null
  const subscriptionScore = subscriptionsPct !== null
    ? Math.round(clamp(1 - subscriptionsPct / 0.15) * 10) // penalise >15% of income
    : 5                                                // neutral

  const total = clamp(savingsScore + budgetScore + balanceScore + stabilityScore + subscriptionScore, 0, 100)

  return {
    total,
    savingsRate: savingsScore,
    budgetAdherence: budgetScore,
    balanceBuffer: balanceScore,
    spendingStability: stabilityScore,
    subscriptionRatio: subscriptionScore,
    band: band(total),
    inputs: {
      savingsRatePct,
      budgetsSet,
      budgetsExceeded,
      monthsOfExpensesCovered,
      spendChangePct,
      subscriptionsPct,
      monthlyIncome,
    },
  }
}

const BAND_EMOJI: Record<HealthScoreBreakdown['band'], string> = {
  excellent: '🟢',
  good: '🔵',
  fair: '🟡',
  needs_work: '🔴',
}

const BAND_LABEL: Record<HealthScoreBreakdown['band'], string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  needs_work: 'Needs work',
}

export function formatFinancialHealthScore(score: HealthScoreBreakdown): string {
  const emoji = BAND_EMOJI[score.band]
  const label = BAND_LABEL[score.band]

  let out = `${emoji} *Your financial health score: ${score.total}/100 — ${label}*\n\n`

  out += `*Score breakdown:*\n`
  out += `• Savings rate: ${score.savingsRate}/30`
  if (score.inputs.savingsRatePct !== null) {
    out += ` _(saving ~${Math.round(score.inputs.savingsRatePct * 100)}% of income)_`
  }
  out += `\n`

  out += `• Budget adherence: ${score.budgetAdherence}/25`
  if (score.inputs.budgetsSet > 0) {
    out += ` _(${score.inputs.budgetsSet - score.inputs.budgetsExceeded}/${score.inputs.budgetsSet} budgets on track)_`
  } else {
    out += ` _(no budgets set — try setting some!)_`
  }
  out += `\n`

  out += `• Balance buffer: ${score.balanceBuffer}/20 _(${score.inputs.monthsOfExpensesCovered.toFixed(1)} months of expenses covered)_\n`

  out += `• Spending stability: ${score.spendingStability}/15`
  if (score.inputs.spendChangePct !== null) {
    const pct = Math.round(Math.abs(score.inputs.spendChangePct) * 100)
    const dir = score.inputs.spendChangePct > 0 ? 'up' : 'down'
    out += ` _(${pct}% ${dir} vs last month)_`
  }
  out += `\n`

  out += `• Subscription load: ${score.subscriptionRatio}/10`
  if (score.inputs.subscriptionsPct !== null) {
    out += ` _(${Math.round(score.inputs.subscriptionsPct * 100)}% of income on subscriptions)_`
  }
  out += `\n\n`

  out += `_This is informational only, not financial advice._`
  return out
}
