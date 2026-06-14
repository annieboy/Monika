/**
 * Savings goal CRUD and NLP parsing.
 *
 * Users set goals via WhatsApp ("I want to save £2,000 for a holiday by December")
 * and track progress ("my savings goals"). Goals are stored in savings_goals and
 * the current_amount is updated monthly from the financial snapshot savings rate.
 */
import type { PrismaClient } from '@prisma/client'

export interface GoalParseResult {
  name: string
  targetAmount: number
  targetDate: Date | undefined
  monthlySavings: number | undefined
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export function parseGoalFromMessage(message: string): GoalParseResult | null {
  const amountMatch = message.match(/£([\d,]+(?:\.\d{1,2})?)/i)
  if (!amountMatch?.[1]) return null

  const targetAmount = parseFloat(amountMatch[1].replace(/,/g, ''))
  if (isNaN(targetAmount) || targetAmount <= 0) return null

  const nameMatch = message.match(/(?:for\s+(?:a\s+|an\s+|my\s+)?)([\w\s]+?)(?:\s+by|\s+in|\s+before|\s*$)/i)
  const name = nameMatch?.[1]?.trim() ?? 'Savings goal'

  const monthlyMatch = message.match(/£([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per)\s*month/i)
  const monthlySavings = monthlyMatch?.[1]
    ? parseFloat(monthlyMatch[1].replace(/,/g, ''))
    : undefined

  let targetDate: Date | undefined

  const byMonthMatch = message.match(
    /by\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{4})?/i,
  )
  if (byMonthMatch?.[1]) {
    const key = byMonthMatch[1].toLowerCase().slice(0, 3)
    const month = MONTH_MAP[key] ?? 11
    const year = byMonthMatch[2] ? parseInt(byMonthMatch[2]) : new Date().getFullYear()
    targetDate = new Date(year, month, 1)
    if (targetDate < new Date()) targetDate = new Date(year + 1, month, 1)
  }

  const inMonthsMatch = message.match(/in\s+(\d+)\s+months?/i)
  if (!targetDate && inMonthsMatch?.[1]) {
    targetDate = new Date(Date.now() + parseInt(inMonthsMatch[1]) * 30 * 86_400_000)
  }

  return { name, targetAmount, targetDate, monthlySavings }
}

const fmt = (n: number): string => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function createGoal(
  prisma: PrismaClient,
  userId: string,
  goal: GoalParseResult,
): Promise<string> {
  const created = await prisma.savingsGoal.create({
    data: {
      userId,
      name: goal.name,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate ?? null,
      monthlySavings: goal.monthlySavings ?? null,
      status: 'active',
    },
  })

  let response = `Goal set! 🎯 *${created.name}* — ${fmt(goal.targetAmount)}`

  if (goal.monthlySavings) {
    const months = Math.ceil(goal.targetAmount / goal.monthlySavings)
    response += `\n\nSaving ${fmt(goal.monthlySavings)}/month, you'll reach it in about *${months} months*.`
  } else if (goal.targetDate) {
    const months = Math.max(1, Math.ceil((goal.targetDate.getTime() - Date.now()) / (30 * 86_400_000)))
    const required = goal.targetAmount / months
    const dateStr = goal.targetDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    response += `\n\nTo hit your *${dateStr}* deadline, you need to save *${fmt(required)}/month*.`
  }

  response += `\n\nSay "my savings goals" to check progress anytime.`
  return response
}

export async function listGoals(prisma: PrismaClient, userId: string): Promise<string> {
  const goals = await prisma.savingsGoal.findMany({
    where: { userId, status: { in: ['active', 'achieved'] } },
    orderBy: { createdAt: 'asc' },
  })

  if (goals.length === 0) {
    return `You don't have any savings goals yet.\n\nTry: *"I want to save £2,000 for a holiday by December"*`
  }

  let out = `Your savings goals:\n\n`
  for (const g of goals) {
    const pct = Math.min(100, Math.round((Number(g.currentAmount) / Number(g.targetAmount)) * 100))
    const filled = Math.round(pct / 10)
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
    const icon = g.status === 'achieved' ? '✅' : '🎯'
    out += `${icon} *${g.name}*\n`
    out += `${bar} ${pct}%\n`
    out += `${fmt(Number(g.currentAmount))} of ${fmt(Number(g.targetAmount))}`
    if (g.targetDate) {
      out += ` · Due ${g.targetDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
    }
    out += `\n\n`
  }

  return out.trim()
}
