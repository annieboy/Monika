/**
 * Debt payoff milestone notification service.
 *
 * Runs daily. Checks spend-down goals (SavingsGoal where name starts with
 * "Pay off") for milestone crossings (25/50/75/100%). Sends a celebratory
 * WhatsApp message on each new milestone.
 *
 * Rate-limited: one notification per goal per milestone (tracked via auditLog).
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface DebtMilestoneResult {
  processed: number
  notified: number
  errors: number
}

const MILESTONES = [25, 50, 75, 100] as const
const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function currentMilestone(pct: number): number | null {
  for (const m of [...MILESTONES].reverse()) {
    if (pct >= m) return m
  }
  return null
}

function buildMessage(goalName: string, pct: number, paid: number, target: number): string {
  const debtName = goalName.replace('Pay off ', '').replace('Pay Off ', '')
  if (pct >= 100) {
    return (
      `🎉 *${debtName} — fully paid off!*\n\n` +
      `You've cleared *${fmt(target)}*. That's a huge financial win! 🏆\n\n` +
      `Say *"my debt goals"* to see your other payoff targets, or *"suggest savings goals"* to put that money to work.`
    )
  }
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
  const remaining = target - paid
  return (
    `💳 *${debtName} — ${pct}% paid off!*\n\n` +
    `${bar}\n` +
    `${fmt(paid)} paid of ${fmt(target)} — ${fmt(remaining)} to go.\n\n` +
    `You're making great progress — keep it up! 💪`
  )
}

async function getPhone(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappPhoneEnc: true },
  })
  if (!user?.whatsappPhoneEnc) return null
  try {
    return decrypt(Buffer.from(user.whatsappPhoneEnc), config.ENCRYPTION_KEY).toString('utf-8')
  } catch {
    return null
  }
}

async function wasNotifiedForMilestone(
  prisma: PrismaClient,
  userId: string,
  goalId: string,
  milestone: number,
): Promise<boolean> {
  const hit = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'debt_milestone_sent',
      eventData: { path: ['goalId'], equals: goalId },
    },
    select: { eventData: true },
  })
  if (!hit) return false
  const data = hit.eventData as { milestone?: number }
  return (data.milestone ?? 0) >= milestone
}

export async function runDebtMilestoneBatch(prisma: PrismaClient): Promise<DebtMilestoneResult> {
  const activeUsers = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active' },
    distinct: ['userId'],
    select: { userId: true },
  })

  let notified = 0
  let errors = 0

  for (const { userId } of activeUsers) {
    try {
      const goals = await prisma.savingsGoal.findMany({
        where: {
          userId,
          status: { in: ['active', 'paused', 'achieved'] },
          name: { startsWith: 'Pay off' },
        },
        select: { id: true, name: true, targetAmount: true, currentAmount: true },
      })

      if (goals.length === 0) continue

      const phone = await getPhone(prisma, userId)
      if (!phone) continue

      const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
      const accessToken = config.WHATSAPP_ACCESS_TOKEN
      if (!phoneNumberId || !accessToken) continue

      for (const goal of goals) {
        const paid = Number(goal.currentAmount)
        const target = Number(goal.targetAmount)
        if (target <= 0) continue
        const pct = Math.min(100, Math.round((paid / target) * 100))
        const milestone = currentMilestone(pct)
        if (!milestone) continue

        if (await wasNotifiedForMilestone(prisma, userId, goal.id, milestone)) continue

        const msg = buildMessage(goal.name, milestone, paid, target)
        await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)

        await prisma.auditLog.create({
          data: {
            userId,
            eventType: 'debt_milestone_sent',
            eventData: { goalId: goal.id, goalName: goal.name, milestone, pct },
          },
        })

        notified++
        logger.info({ userId, goalId: goal.id, milestone }, 'Debt milestone notification sent')
      }
    } catch (err) {
      logger.error({ err, userId }, 'Debt milestone check failed for user')
      errors++
    }
  }

  return { processed: activeUsers.length, notified, errors }
}
