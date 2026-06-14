/**
 * Savings goal progress notifications.
 *
 * Runs as a BullMQ batch job. For every active savings goal, checks whether
 * the user has crossed a new milestone (25 / 50 / 75 / 100 %) since the last
 * notification. Sends a WhatsApp message and updates lastProgressNotifiedAt.
 *
 * Rate-limit: one notification per goal per milestone. A goal can only send
 * each milestone once (tracked via lastProgressNotifiedAt + the computed pct
 * at notification time stored in the audit log).
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface GoalProgressResult {
  notified: number
  errors: number
}

const MILESTONES = [25, 50, 75, 100] as const

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function milestone(pct: number): 25 | 50 | 75 | 100 | null {
  // Return the highest milestone this percentage has reached
  for (const m of [...MILESTONES].reverse()) {
    if (pct >= m) return m
  }
  return null
}

function buildMessage(goalName: string, pct: number, currentAmount: number, targetAmount: number): string {
  if (pct >= 100) {
    return (
      `🎉 You've hit your *${goalName}* savings goal!\n\n` +
      `You saved ${fmt(currentAmount)} — target was ${fmt(targetAmount)}. Amazing work! 🏆\n\n` +
      `Say "my savings goals" to set your next one.`
    )
  }
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))
  return (
    `🎯 *${goalName}* is ${pct}% funded!\n\n` +
    `${bar}\n` +
    `${fmt(currentAmount)} of ${fmt(targetAmount)} saved.\n\n` +
    `Keep it up — you're on track! 💪`
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

export async function runGoalProgressBatch(prisma: PrismaClient): Promise<GoalProgressResult> {
  const goals = await prisma.savingsGoal.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      userId: true,
      name: true,
      targetAmount: true,
      currentAmount: true,
      lastProgressNotifiedAt: true,
    },
  })

  let notified = 0
  let errors = 0

  for (const goal of goals) {
    try {
      const target = Number(goal.targetAmount)
      const current = Number(goal.currentAmount)
      if (target <= 0) continue

      const pct = Math.min(100, Math.round((current / target) * 100))
      const reached = milestone(pct)
      if (!reached) continue

      // Determine the last milestone we notified about (stored as auditLog event)
      const lastNotif = await prisma.auditLog.findFirst({
        where: {
          userId: goal.userId,
          eventType: 'goal_progress_notified',
          eventData: { path: ['goalId'], equals: goal.id },
        },
        orderBy: { createdAt: 'desc' },
        select: { eventData: true },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastMilestone = (lastNotif?.eventData as any)?.milestone as number | undefined
      if (lastMilestone && lastMilestone >= reached) continue // already notified at this level

      const phone = await getPhone(prisma, goal.userId)
      if (!phone) continue

      const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
      const accessToken = config.WHATSAPP_ACCESS_TOKEN
      if (!phoneNumberId || !accessToken) continue

      const message = buildMessage(goal.name, pct, current, target)
      await sendWhatsAppMessage(phone, message, phoneNumberId, accessToken)

      // Update lastProgressNotifiedAt and log the milestone
      await Promise.all([
        prisma.savingsGoal.update({
          where: { id: goal.id },
          data: { lastProgressNotifiedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            userId: goal.userId,
            eventType: 'goal_progress_notified',
            serviceName: 'notifications',
            eventData: { goalId: goal.id, milestone: reached, pct },
          },
        }),
        // Mark goal achieved if 100%
        ...(pct >= 100
          ? [prisma.savingsGoal.update({ where: { id: goal.id }, data: { status: 'achieved' } })]
          : []),
      ])

      notified++
      logger.info({ userId: goal.userId, goalId: goal.id, milestone: reached }, 'Goal progress notification sent')
    } catch (err) {
      errors++
      logger.error({ err, goalId: goal.id }, 'Goal progress notification failed')
    }
  }

  return { notified, errors }
}
