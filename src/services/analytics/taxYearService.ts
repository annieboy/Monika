/**
 * UK Tax Year Summary service.
 *
 * Produces an income and spending breakdown for the UK tax year (6 April – 5 April).
 * Helps users who are self-employed or need to self-assess.
 *
 * Reports:
 *   - Total income (salary + other credits)
 *   - Total spending by category
 *   - Potential business-expense categories (transport, meals, tech)
 *   - Tax year label (e.g. "2025/26")
 */
import type { PrismaClient } from '@prisma/client'

export interface TaxYearSummary {
  taxYear: string          // e.g. "2025/26"
  fromDate: Date
  toDate: Date
  totalIncome: number
  totalSpend: number
  categoryBreakdown: Array<{ category: string; total: number }>
  potentialExpenseCategories: string[]
}

/** Returns the UK tax year dates that contain `now`. */
export function getTaxYearDates(now = new Date()): { from: Date; to: Date; label: string } {
  const year = now.getFullYear()
  const month = now.getMonth() // 0-indexed
  const day = now.getDate()

  // Tax year starts 6 April
  const startYear = month > 3 || (month === 3 && day >= 6) ? year : year - 1
  return {
    from: new Date(startYear, 3, 6),          // 6 April
    to: new Date(startYear + 1, 3, 5, 23, 59, 59, 999), // 5 April end of day
    label: `${startYear}/${String(startYear + 1).slice(2)}`,
  }
}

const EXPENSE_CATEGORIES = new Set([
  'transport',
  'travel',
  'meals',
  'eating out',
  'technology',
  'software',
  'equipment',
  'office',
  'professional',
  'training',
  'education',
  'marketing',
  'advertising',
  'communication',
  'phone',
  'internet',
])

export async function getTaxYearSummary(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<TaxYearSummary> {
  const { from, to, label } = getTaxYearDates(now)

  // Total income (positive transactions)
  const incomeAgg = await prisma.transaction.aggregate({
    where: {
      userId,
      transactionDate: { gte: from, lte: to },
      amount: { gt: 0 },
    },
    _sum: { amount: true },
  })
  const totalIncome = Number(incomeAgg._sum.amount ?? 0)

  // Total spend (negative transactions — use absolute value)
  const spendAgg = await prisma.transaction.aggregate({
    where: {
      userId,
      transactionDate: { gte: from, lte: to },
      amount: { lt: 0 },
    },
    _sum: { amount: true },
  })
  const totalSpend = Math.abs(Number(spendAgg._sum.amount ?? 0))

  // Category breakdown (spending only)
  const categoryRows = await prisma.transaction.groupBy({
    by: ['category'],
    where: {
      userId,
      transactionDate: { gte: from, lte: to },
      amount: { lt: 0 },
      category: { not: null },
    },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'asc' } }, // most negative first
  })

  const categoryBreakdown = categoryRows
    .filter(r => r.category)
    .map(r => ({
      category: r.category!,
      total: Math.abs(Number(r._sum.amount ?? 0)),
    }))

  // Identify potential business expense categories
  const potentialExpenseCategories = categoryBreakdown
    .filter(r => EXPENSE_CATEGORIES.has(r.category.toLowerCase()))
    .map(r => r.category)

  return {
    taxYear: label,
    fromDate: from,
    toDate: to,
    totalIncome,
    totalSpend,
    categoryBreakdown,
    potentialExpenseCategories,
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function formatTaxYearSummary(summary: TaxYearSummary): string {
  const { taxYear, totalIncome, totalSpend, categoryBreakdown, potentialExpenseCategories } = summary

  let out = `📋 *UK Tax Year Summary ${taxYear}*\n\n`
  out += `Total income: *${fmt(totalIncome)}*\n`
  out += `Total spending: *${fmt(totalSpend)}*\n`
  out += `Net: *${fmt(totalIncome - totalSpend)}*\n\n`

  if (categoryBreakdown.length > 0) {
    out += `*Spending by category:*\n`
    for (const row of categoryBreakdown.slice(0, 10)) {
      out += `  • ${row.category}: ${fmt(row.total)}\n`
    }
    if (categoryBreakdown.length > 10) {
      out += `  _…and ${categoryBreakdown.length - 10} more categories_\n`
    }
    out += `\n`
  }

  if (potentialExpenseCategories.length > 0) {
    out += `💼 *Potential business expenses:*\n`
    out += `Categories that may be deductible if you're self-employed:\n`
    out += potentialExpenseCategories.map(c => `  • ${c}`).join('\n')
    out += `\n\n`
  }

  out += `_This summary covers 6 April ${summary.fromDate.getFullYear()} – 5 April ${summary.toDate.getFullYear()}. `
  out += `Always consult a qualified accountant for tax advice._`

  return out
}
