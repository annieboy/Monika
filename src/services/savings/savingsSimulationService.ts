/**
 * Savings pot simulation.
 *
 * Answers "what if" questions:
 *   - "If I cut eating out by £50/month, how long to save £2,000?"
 *   - "If I save £200/month, when will I reach my holiday goal?"
 *
 * Parses the hypothetical from the user's message, finds matching
 * active savings goals, and computes projected months to target.
 */
import type { PrismaClient } from '@prisma/client'

export interface SimulationInput {
  monthlySaving: number        // extra saving per month from cut/saving
  targetAmount?: number        // explicit target, or use active goal
  goalName?: string            // which goal to match
}

export interface SimulationResult {
  monthlySaving: number
  targetAmount: number
  goalName: string
  currentSaved: number
  monthsToTarget: number
  projectedDate: Date
  alreadyAchieved: boolean
}

// ── NLP parsing ───────────────────────────────────────────────────────────────

export function parseSimulation(message: string): SimulationInput | null {
  // "if I save £200/month" or "if I put aside £150 a month"
  const saveMatch = message.match(
    /(?:if\s+i\s+(?:save|put\s+aside|set\s+aside|save\s+an\s+extra)\s+)?£([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per|a)\s*month/i,
  )
  // "cut (...) by £50/month" or "reduce (...) by £50"
  const cutMatch = message.match(
    /(?:cut|reduce|spend\s+less)\s+(?:[\w\s]+\s+)?by\s+£([\d,]+(?:\.\d{1,2})?)/i,
  )

  const rawAmount = saveMatch?.[1] ?? cutMatch?.[1]
  if (!rawAmount) return null

  const monthlySaving = parseFloat(rawAmount.replace(/,/g, ''))
  if (isNaN(monthlySaving) || monthlySaving <= 0) return null

  // Optional explicit target — avoid matching the monthly saving amount
  const targetMatch = message.match(/(?:reach|hit|get\s+to|save\s+up\s+to|save\s+a\s+total)\s+£([\d,]+(?:\.\d{1,2})?)/i)
  const targetAmount = targetMatch?.[1] ? parseFloat(targetMatch[1].replace(/,/g, '')) : undefined

  // Optional goal name: "for my holiday", "for a car"
  const goalMatch = message.match(/for\s+(?:my\s+|a\s+|an\s+)?([\w\s]+?)(?:\s*\?|$|\s+goal)/i)
  const goalName = goalMatch?.[1]?.trim()

  return {
    monthlySaving,
    ...(targetAmount !== undefined ? { targetAmount } : {}),
    ...(goalName !== undefined ? { goalName } : {}),
  }
}

// ── Simulation engine ─────────────────────────────────────────────────────────

export async function runSavingsSimulation(
  prisma: PrismaClient,
  userId: string,
  input: SimulationInput,
): Promise<SimulationResult> {
  let targetAmount = input.targetAmount
  let goalName = input.goalName ?? 'Savings goal'
  let currentSaved = 0

  if (!targetAmount) {
    // Find matching active savings goal
    const where = input.goalName
      ? { userId, status: 'active', name: { contains: input.goalName, mode: 'insensitive' as const } }
      : { userId, status: 'active' }

    const goal = await prisma.savingsGoal.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      select: { name: true, targetAmount: true, currentAmount: true },
    })

    if (goal) {
      targetAmount = Number(goal.targetAmount)
      goalName = goal.name
      currentSaved = Number(goal.currentAmount)
    } else {
      // Fall back to a generic £1,000 target if no goal exists
      targetAmount = 1000
    }
  }

  const remaining = Math.max(0, targetAmount - currentSaved)
  const alreadyAchieved = remaining === 0
  const monthsToTarget = alreadyAchieved ? 0 : Math.ceil(remaining / input.monthlySaving)

  const projectedDate = new Date()
  projectedDate.setMonth(projectedDate.getMonth() + monthsToTarget)

  return {
    monthlySaving: input.monthlySaving,
    targetAmount,
    goalName,
    currentSaved,
    monthsToTarget,
    projectedDate,
    alreadyAchieved,
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtMonth = (d: Date): string =>
  d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export function formatSimulationResult(result: SimulationResult): string {
  if (result.alreadyAchieved) {
    return `✅ You've already reached your *${result.goalName}* goal of ${fmt(result.targetAmount)}! 🎉`
  }

  const remaining = result.targetAmount - result.currentSaved
  let out = `🎯 *Savings simulation — ${result.goalName}*\n\n`
  out += `Saving *${fmt(result.monthlySaving)}/month* extra:\n\n`

  if (result.currentSaved > 0) {
    out += `Already saved: *${fmt(result.currentSaved)}*\n`
  }
  out += `Target: *${fmt(result.targetAmount)}*\n`
  if (result.currentSaved > 0) {
    out += `Remaining: *${fmt(remaining)}*\n`
  }
  out += `\nYou'd reach your goal in *${result.monthsToTarget} month${result.monthsToTarget === 1 ? '' : 's'}* — by *${fmtMonth(result.projectedDate)}*. 🗓️`

  return out
}
