/**
 * Spend-down goal service — debt payoff tracker.
 *
 * Reuses SavingsGoal with names prefixed "Pay off" to distinguish from
 * savings-up goals. Users can track credit card, overdraft, or loan payoffs.
 *
 * Supported commands:
 *   "Pay off my £3,000 credit card by June"
 *   "Clear my £500 overdraft in 3 months"
 *   "Pay down £1,200 personal loan at £150/month"
 *   "My debt goals" / "Show my payoff goals"
 *   "I paid £200 off my credit card"
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const DEBT_NAMES = ['credit card', 'overdraft', 'loan', 'debt', 'mortgage', 'finance', 'buy now pay later', 'bnpl']

function normaliseDebtName(raw: string): string {
  const lower = raw.toLowerCase()
  for (const name of DEBT_NAMES) {
    if (lower.includes(name)) return name
  }
  return lower
}

// ── Parsing ───────────────────────────────────────────────────────────────────

interface SpendDownParsed {
  name: string
  targetAmount: number
  monthlyPayment?: number
  targetDate?: Date
}

export function parseSpendDown(message: string): SpendDownParsed | null {
  // "pay off my £3,000 credit card by June 2027"
  // "pay off £3,000 by June"
  // "clear my £500 overdraft in 3 months"
  // "pay down £1,200 personal loan at £150/month"
  const amountMatch = message.match(/£([\d,]+(?:\.\d{1,2})?)/)
  if (!amountMatch) return null

  const targetAmount = parseFloat(amountMatch[1]!.replace(/,/g, ''))
  if (isNaN(targetAmount) || targetAmount <= 0) return null

  // Identify debt type
  const lower = message.toLowerCase()
  const debtType = DEBT_NAMES.find(n => lower.includes(n)) ?? 'debt'
  const name = `Pay off ${debtType}`

  // Monthly payment: "at £150/month" or "£150 per month"
  const paymentMatch = message.match(/(?:at\s+)?£([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*month|per\s+month|a\s+month)/i)
  const monthlyPayment = paymentMatch
    ? parseFloat(paymentMatch[1]!.replace(/,/g, ''))
    : undefined

  // Target date: "by June 2027" / "by June" / "in 3 months"
  let targetDate: Date | undefined
  const byMatch = message.match(/by\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/i)
  if (byMatch) {
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    }
    const month = months[byMatch[1]!.toLowerCase()] ?? 0
    const year = byMatch[2] ? parseInt(byMatch[2]) : new Date().getFullYear()
    const d = new Date(year, month, 1)
    if (d < new Date()) d.setFullYear(d.getFullYear() + 1)
    targetDate = d
  }
  const inMatch = message.match(/in\s+(\d+)\s+months?/i)
  if (inMatch && !targetDate) {
    const months = parseInt(inMatch[1]!)
    const d = new Date()
    d.setMonth(d.getMonth() + months)
    targetDate = d
  }

  const result: SpendDownParsed = { name, targetAmount }
  if (monthlyPayment !== undefined) result.monthlyPayment = monthlyPayment
  if (targetDate !== undefined) result.targetDate = targetDate
  return result
}

export function isListSpendDownRequest(message: string): boolean {
  return /(?:my\s+)?(?:debt|payoff|pay.?off|spend.?down)\s+goals?/i.test(message)
    || /show\s+(?:my\s+)?(?:debt|payoff)/i.test(message)
}

// ── Storage ───────────────────────────────────────────────────────────────────

export async function createSpendDownGoal(
  prisma: PrismaClient,
  userId: string,
  parsed: SpendDownParsed,
): Promise<string> {
  await prisma.savingsGoal.create({
    data: {
      userId,
      name: parsed.name,
      targetAmount: parsed.targetAmount,
      currentAmount: 0,
      targetDate: parsed.targetDate ?? null,
      monthlySavings: parsed.monthlyPayment ?? null,
      status: 'active',
    },
  })

  let reply = `✅ *Payoff goal created!*\n\n*${parsed.name}*\n`
  reply += `Target: ${fmt(parsed.targetAmount)}\n`
  if (parsed.monthlyPayment) {
    const months = Math.ceil(parsed.targetAmount / parsed.monthlyPayment)
    reply += `At ${fmt(parsed.monthlyPayment)}/month → ${months} months to go\n`
  }
  if (parsed.targetDate) {
    reply += `Target date: ${parsed.targetDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}\n`
  }
  reply += `\nSay *"I paid £X off my ${parsed.name.replace('Pay off ', '')}"* to record a payment.`
  return reply
}

export async function listSpendDownGoals(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const goals = await prisma.savingsGoal.findMany({
    where: {
      userId,
      status: { in: ['active', 'paused'] },
      name: { startsWith: 'Pay off' },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (goals.length === 0) {
    return (
      `You don't have any debt payoff goals yet.\n\n` +
      `Try: *"Pay off my £3,000 credit card by June"* or *"Clear my £500 overdraft in 3 months"*`
    )
  }

  let out = `💳 *Your debt payoff goals:*\n\n`
  for (const g of goals) {
    const target = Number(g.targetAmount)
    const paid = Number(g.currentAmount)
    const remaining = Math.max(0, target - paid)
    const pct = target > 0 ? Math.min(100, Math.round((paid / target) * 100)) : 0
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
    out += `*${g.name}*\n`
    out += `${bar} ${pct}%\n`
    out += `${fmt(paid)} paid of ${fmt(target)} — ${fmt(remaining)} remaining\n`
    if (g.monthlySavings) {
      const monthsLeft = Math.ceil(remaining / Number(g.monthlySavings))
      out += `At ${fmt(Number(g.monthlySavings))}/month → ${monthsLeft} months to go\n`
    }
    if (g.targetDate) {
      out += `Target: ${g.targetDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}\n`
    }
    out += '\n'
  }
  return out.trim()
}

export async function updateSpendDownProgress(
  prisma: PrismaClient,
  userId: string,
  debtType: string,
  amountPaid: number,
): Promise<string> {
  // Find the most recently active payoff goal matching the debt type
  const goal = await prisma.savingsGoal.findFirst({
    where: {
      userId,
      status: { in: ['active', 'paused'] },
      name: { contains: debtType, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!goal) {
    return (
      `I couldn't find an active payoff goal for *${debtType}*.\n\n` +
      `Set one first: *"Pay off my ${debtType}"*`
    )
  }

  const newAmount = Math.min(Number(goal.targetAmount), Number(goal.currentAmount) + amountPaid)
  const achieved = newAmount >= Number(goal.targetAmount)

  await prisma.savingsGoal.update({
    where: { id: goal.id },
    data: {
      currentAmount: newAmount,
      status: achieved ? 'achieved' : goal.status,
    },
  })

  if (achieved) {
    return (
      `🎉 *Congratulations!* You've completely paid off your *${goal.name.replace('Pay off ', '')}*!\n\n` +
      `${fmt(Number(goal.targetAmount))} cleared. That's a huge achievement! 💪`
    )
  }

  const remaining = Number(goal.targetAmount) - newAmount
  const pct = Math.round((newAmount / Number(goal.targetAmount)) * 100)
  return (
    `✅ Payment recorded! *${fmt(amountPaid)}* paid off your *${goal.name.replace('Pay off ', '')}*.\n\n` +
    `Progress: ${pct}% (${fmt(remaining)} remaining)`
  )
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleSpendDown(
  prisma: PrismaClient,
  userId: string,
  message: string,
): Promise<string> {
  // Record a payment: "I paid £200 off my credit card"
  const paymentMatch = message.match(/(?:paid|paying|made\s+a\s+payment\s+of)\s+£([\d,]+(?:\.\d{1,2})?)\s+(?:off|on|to(?:wards)?)\s+(?:my\s+)?([\w\s]+?)(?:\s*$)/i)
  if (paymentMatch) {
    const amount = parseFloat(paymentMatch[1]!.replace(/,/g, ''))
    const debtType = normaliseDebtName(paymentMatch[2]!)
    if (!isNaN(amount) && amount > 0) {
      return updateSpendDownProgress(prisma, userId, debtType, amount)
    }
  }

  // List goals
  if (isListSpendDownRequest(message)) {
    return listSpendDownGoals(prisma, userId)
  }

  // Create a goal
  const parsed = parseSpendDown(message)
  if (parsed) {
    return createSpendDownGoal(prisma, userId, parsed)
  }

  // Help text
  return (
    `You can track debt payoff goals and celebrate clearing them! 💳\n\n` +
    `• *"Pay off my £3,000 credit card by June"*\n` +
    `• *"Clear my £500 overdraft in 3 months"*\n` +
    `• *"Pay down £1,200 loan at £150/month"*\n` +
    `• *"My debt goals"* — see all payoff goals\n` +
    `• *"I paid £200 off my credit card"* — record a payment`
  )
}
