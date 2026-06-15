/**
 * Financial goal suggestion service.
 *
 * Analyses spending patterns and balance to proactively suggest
 * relevant savings goals the user might not have set up yet.
 *
 * Suggestions are filtered against existing goals to avoid duplicates.
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface GoalSuggestion {
  title: string
  why: string
  targetAmount: number
  monthlySuggested: number
  monthsToTarget: number
  prompt: string
}

export async function suggestFinancialGoals(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  const [spending, accounts, existingGoals] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['category'],
      where: { userId, amount: { gt: 0 }, transactionDate: { gte: threeMonthsAgo } },
      _sum: { amount: true },
    }),
    prisma.account.findMany({
      where: { userId },
      select: { currentBalance: true },
    }),
    prisma.savingsGoal.findMany({
      where: { userId, status: { in: ['active', 'paused'] } },
      select: { name: true },
    }),
  ])

  const totalBalance = accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0)
  const categoryMap: Record<string, number> = {}
  for (const s of spending) {
    const key = (s.category ?? 'other').toLowerCase()
    categoryMap[key] = Number((s._sum as { amount?: unknown }).amount ?? 0)
  }

  const totalSpend = Object.values(categoryMap).reduce((a, b) => a + b, 0)
  const monthlySpend = totalSpend / 3
  const existingGoalNames = existingGoals.map(g => g.name.toLowerCase())

  const suggestions: GoalSuggestion[] = []

  // Emergency fund suggestion
  const essentialMonthly = (
    (categoryMap['groceries'] ?? 0) +
    (categoryMap['rent'] ?? 0) +
    (categoryMap['housing'] ?? 0) +
    (categoryMap['utilities'] ?? 0) +
    (categoryMap['transport'] ?? 0)
  ) / 3
  const target3m = essentialMonthly * 3
  if (totalBalance < target3m && !existingGoalNames.some(n => n.includes('emergency'))) {
    const monthly = Math.max(50, Math.round(essentialMonthly * 0.15))
    suggestions.push({
      title: 'Emergency fund (3 months)',
      why: `Your current balance (${fmt(totalBalance)}) is below 3 months of essential expenses (${fmt(target3m)}).`,
      targetAmount: target3m,
      monthlySuggested: monthly,
      monthsToTarget: Math.ceil((target3m - totalBalance) / monthly),
      prompt: `Set up an emergency fund goal of ${fmt(target3m)}`,
    })
  }

  // Holiday fund — if travel spending detected
  const travelSpend = (categoryMap['travel'] ?? 0) + (categoryMap['flights'] ?? 0) + (categoryMap['hotels'] ?? 0)
  if (travelSpend > 100 && !existingGoalNames.some(n => n.includes('holiday') || n.includes('travel'))) {
    const target = 1500
    const monthly = 150
    suggestions.push({
      title: 'Holiday fund',
      why: `You've spent ${fmt(travelSpend)} on travel in the last 3 months — a dedicated holiday pot would let you travel without dipping into day-to-day money.`,
      targetAmount: target,
      monthlySuggested: monthly,
      monthsToTarget: Math.ceil(target / monthly),
      prompt: `Save £${target} for a holiday fund`,
    })
  }

  // House deposit — if renting detected
  const rentSpend = (categoryMap['rent'] ?? 0) + (categoryMap['housing'] ?? 0)
  const monthlyRent = rentSpend / 3
  if (monthlyRent > 400 && !existingGoalNames.some(n => n.includes('house') || n.includes('deposit'))) {
    const target = 20000
    const monthly = Math.round(monthlyRent * 0.2)
    suggestions.push({
      title: 'House deposit',
      why: `You're paying ${fmt(monthlyRent)}/month in rent. A Lifetime ISA (LISA) adds a 25% government bonus on up to £4,000/year saved towards a first home.`,
      targetAmount: target,
      monthlySuggested: monthly,
      monthsToTarget: Math.ceil(target / monthly),
      prompt: `Start saving £${target.toLocaleString()} for a house deposit`,
    })
  }

  // New car fund — if fuel/transport is high
  const transportSpend = (categoryMap['transport'] ?? 0) + (categoryMap['fuel'] ?? 0)
  const monthlyTransport = transportSpend / 3
  if (monthlyTransport > 200 && !existingGoalNames.some(n => n.includes('car'))) {
    const target = 5000
    const monthly = 200
    suggestions.push({
      title: 'New car fund',
      why: `You're spending ${fmt(monthlyTransport)}/month on transport. Saving for a car outright (or a larger deposit) avoids expensive PCP finance.`,
      targetAmount: target,
      monthlySuggested: monthly,
      monthsToTarget: Math.ceil(target / monthly),
      prompt: `Save £${target.toLocaleString()} for a new car`,
    })
  }

  // General rainy day pot if balance is just OK and no goals
  if (suggestions.length === 0 && existingGoals.length === 0) {
    const target = 1000
    const monthly = Math.max(50, Math.round(monthlySpend * 0.05))
    suggestions.push({
      title: 'Rainy day pot',
      why: 'A small rainy day fund is the foundation of financial resilience — even £500–1,000 covers most unexpected expenses.',
      targetAmount: target,
      monthlySuggested: monthly,
      monthsToTarget: Math.ceil(target / monthly),
      prompt: `Save £${target.toLocaleString()} in a rainy day pot`,
    })
  }

  if (suggestions.length === 0) {
    return (
      `🎯 You already have savings goals set up — great work!\n\n` +
      `Say *"show my savings goals"* to check your progress, or ask me for specific goal ideas.`
    )
  }

  let out = `🎯 *Suggested savings goals for you*\n\n`
  out += `Based on your spending patterns, here are goals worth considering:\n\n`

  for (const s of suggestions.slice(0, 3)) {
    out += `*${s.title}*\n`
    out += `${s.why}\n`
    out += `Target: ${fmt(s.targetAmount)} · Save ${fmt(s.monthlySuggested)}/month · ${s.monthsToTarget} months\n`
    out += `Say: _"${s.prompt}"_ to get started\n\n`
  }

  out += `_Suggestions are based on your spending patterns only and are not financial advice._`

  return out
}

export function isGoalSuggestionRequest(message: string): boolean {
  return /suggest.*(?:goal|saving)|(?:goal|saving).*suggest|what.*(?:goal|save\s+for)|recommend.*(?:goal|saving)|should\s+i\s+save\s+for|financial\s+goals?\s+(?:for\s+me|suggest)/i.test(message)
}
