/**
 * Category budget service.
 *
 * Budgets are stored as append-only audit log events (event-sourcing pattern).
 * The current budget for a category is always the latest 'budget_set' event.
 * This avoids schema migrations while maintaining a full history.
 *
 * Supported commands:
 *   "set my eating out budget to £200"
 *   "set a £150 budget for groceries"
 *   "what's my food budget?"
 *   "my budgets" / "show me my budgets"
 */
import type { PrismaClient } from '@prisma/client'
import { TransactionAnalyticsService } from '../analytics/analytics.js'

const fmt = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Parsing ───────────────────────────────────────────────────────────────────

export function parseBudgetSet(message: string): { category: string; amount: number } | null {
  // "set a £200 budget for eating out"
  // "set my groceries budget to £150"
  // "budget £300 for transport"
  const patterns = [
    /set\s+(?:a\s+|my\s+)?£([\d,]+(?:\.\d{1,2})?)\s+budget\s+for\s+([\w\s]+?)(?:\s*$|\s+(?:per|each)\s+month)/i,
    /set\s+(?:a\s+|my\s+)?([\w\s]+?)\s+budget\s+to\s+£([\d,]+(?:\.\d{1,2})?)/i,
    /budget\s+£([\d,]+(?:\.\d{1,2})?)\s+for\s+([\w\s]+?)(?:\s*$)/i,
    /£([\d,]+(?:\.\d{1,2})?)\s+(?:budget|limit)\s+for\s+([\w\s]+?)(?:\s*$)/i,
  ]

  for (const p of patterns) {
    const m = message.match(p)
    if (m) {
      // Pattern group order varies — find amount and category
      const g1 = m[1]?.trim() ?? ''
      const g2 = m[2]?.trim() ?? ''
      // If g1 looks like a number → amount first
      const amountFirst = /^[\d,]+(\.\d{1,2})?$/.test(g1)
      const rawAmount = amountFirst ? g1 : g2
      const rawCategory = amountFirst ? g2 : g1
      const amount = parseFloat(rawAmount.replace(/,/g, ''))
      if (!isNaN(amount) && amount > 0 && rawCategory.length > 1) {
        return { category: rawCategory.toLowerCase(), amount }
      }
    }
  }
  return null
}

export function parseBudgetQuery(message: string): string | null {
  // "what's my food budget?" → "food"
  const m = message.match(/(?:what(?:'?s|\s+is)\s+my\s+)([\w\s]+?)\s+budget/i)
  return m?.[1]?.trim().toLowerCase() ?? null
}

export function isListBudgetsRequest(message: string): boolean {
  return /my\s+budgets?|show\s+(me\s+)?(?:my\s+)?budgets?|all\s+budgets?/i.test(message)
}

// ── Storage (auditLog-backed) ─────────────────────────────────────────────────

async function getCurrentBudget(
  prisma: PrismaClient,
  userId: string,
  category: string,
): Promise<number | null> {
  const row = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'budget_set',
      eventData: { path: ['category'], equals: category },
    },
    orderBy: { createdAt: 'desc' },
    select: { eventData: true },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (row?.eventData as any)?.amount ?? null
}

async function getAllBudgets(
  prisma: PrismaClient,
  userId: string,
): Promise<Array<{ category: string; amount: number }>> {
  // Get the latest budget_set per category using raw SQL grouping
  const rows = await prisma.auditLog.findMany({
    where: { userId, eventType: 'budget_set' },
    orderBy: { createdAt: 'desc' },
    select: { eventData: true },
  })

  // Deduplicate — keep only the latest per category
  const seen = new Map<string, number>()
  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = row.eventData as any
    if (data?.category && data?.amount && !seen.has(data.category)) {
      seen.set(data.category, data.amount)
    }
  }

  return [...seen.entries()].map(([category, amount]) => ({ category, amount }))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function handleBudget(
  prisma: PrismaClient,
  userId: string,
  message: string,
): Promise<string> {
  // List all budgets
  if (isListBudgetsRequest(message)) {
    const budgets = await getAllBudgets(prisma, userId)
    if (budgets.length === 0) {
      return (
        `You haven't set any budgets yet.\n\n` +
        `Try: *"Set a £200 budget for eating out"* or *"Set my groceries budget to £300"*`
      )
    }

    const analytics = new TransactionAnalyticsService(prisma)
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const now = new Date()

    let out = `📊 *Your monthly budgets:*\n\n`
    for (const { category, amount } of budgets) {
      const spend = await analytics.getSpendingByCategory(userId, startOfMonth, now, category)
      const spent = spend.find(c => c.category?.toLowerCase().includes(category))?.total ?? 0
      const pct = amount > 0 ? Math.min(100, Math.round((spent / amount) * 100)) : 0
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
      const status = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢'
      out += `${status} *${category}*\n`
      out += `${bar} ${pct}%\n`
      out += `${fmt(spent)} of ${fmt(amount)} budget used\n\n`
    }
    return out.trim()
  }

  // Set a budget
  const budgetSet = parseBudgetSet(message)
  if (budgetSet) {
    await prisma.auditLog.create({
      data: {
        userId,
        eventType: 'budget_set',
        serviceName: 'budget',
        eventData: { category: budgetSet.category, amount: budgetSet.amount },
      },
    })
    return (
      `Budget set! 📋 *${budgetSet.category}* → *${fmt(budgetSet.amount)}/month*\n\n` +
      `I'll track your spending against this budget. Say *"my budgets"* to see progress.`
    )
  }

  // Query a specific budget
  const queryCategory = parseBudgetQuery(message)
  if (queryCategory) {
    const amount = await getCurrentBudget(prisma, userId, queryCategory)
    if (!amount) {
      return (
        `You haven't set a budget for *${queryCategory}* yet.\n\n` +
        `Try: *"Set a £200 budget for ${queryCategory}"*`
      )
    }

    const analytics = new TransactionAnalyticsService(prisma)
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const spend = await analytics.getSpendingByCategory(userId, startOfMonth, new Date(), queryCategory)
    const spent = spend.find(c => c.category?.toLowerCase().includes(queryCategory))?.total ?? 0
    const pct = Math.min(100, Math.round((spent / amount) * 100))
    const remaining = Math.max(0, amount - spent)

    return (
      `📋 *${queryCategory} budget*\n\n` +
      `Budget: ${fmt(amount)}/month\n` +
      `Spent: ${fmt(spent)} (${pct}%)\n` +
      `Remaining: ${fmt(remaining)}\n\n` +
      (pct >= 100
        ? `⚠️ You've exceeded your budget this month.`
        : pct >= 80
        ? `⚠️ You're getting close to your limit.`
        : `You're on track! 🟢`)
    )
  }

  // Generic budget message
  return (
    `You can set monthly budgets for any spending category. For example:\n\n` +
    `• *"Set a £200 budget for eating out"*\n` +
    `• *"Set my groceries budget to £300"*\n` +
    `• *"What's my transport budget?"*\n` +
    `• *"My budgets"* — see all budgets with progress`
  )
}
