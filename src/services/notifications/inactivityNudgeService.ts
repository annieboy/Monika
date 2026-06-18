/**
 * User inactivity re-engagement service.
 *
 * Runs weekly. For each user who hasn't sent a WhatsApp message in 30 days
 * (no conversation row with role='user' in that window), sends a friendly
 * re-engagement message highlighting a personalised insight.
 *
 * Rate-limited: one nudge per user per 30 days via auditLog.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface InactivityNudgeResult {
  processed: number
  nudged: number
  errors: number
}

const INACTIVITY_DAYS = 30
const MIN_DAYS_BETWEEN_NUDGES = 30
const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

async function wasNudgedRecently(prisma: PrismaClient, userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN_NUDGES * 86_400_000)
  const hit = await prisma.auditLog.findFirst({
    where: { userId, eventType: 'inactivity_nudge_sent', createdAt: { gt: cutoff } },
    select: { id: true },
  })
  return !!hit
}

async function getInsight(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  // Try to find a personalised hook
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)

  const [topCategory, accounts] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['category'],
      where: { userId, amount: { gt: 0 }, transactionDate: { gte: thirtyDaysAgo } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 1,
    }),
    prisma.account.findMany({
      where: { userId },
      select: { currentBalance: true },
    }),
  ])

  const balance = accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0)
  const top = topCategory[0]
  const topSpend = Number((top?._sum as { amount?: unknown })?.amount ?? 0)
  const topCat = top?.category ?? 'general'

  if (topSpend > 0 && balance > 0) {
    return (
      `In the last month, your biggest spend category was *${topCat}* (${fmt(topSpend)}), ` +
      `and your current balance is *${fmt(balance)}*.`
    )
  }
  if (balance > 0) {
    return `Your current balance is *${fmt(balance)}*.`
  }
  return `There's been some activity on your linked account.`
}

function buildMessage(insight: string): string {
  return (
    `👋 *Hey, it's been a while!*\n\n` +
    `${insight}\n\n` +
    `Here's what I can help you with:\n` +
    `• *"How much did I spend this month?"*\n` +
    `• *"Upcoming bills"*\n` +
    `• *"Recommend a savings account"*\n` +
    `• *"Check my emergency fund"*\n\n` +
    `Just reply and I'll pick it up from here.`
  )
}

export async function runInactivityNudgeBatch(prisma: PrismaClient): Promise<InactivityNudgeResult> {
  const inactivityCutoff = new Date(Date.now() - INACTIVITY_DAYS * 86_400_000)

  // Users with active bank connection but no recent user message
  const activeUsers = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active' },
    distinct: ['userId'],
    select: { userId: true },
  })

  let nudged = 0
  let errors = 0

  for (const { userId } of activeUsers) {
    try {
      if (await wasNudgedRecently(prisma, userId)) continue

      // Check if user messaged recently
      const recentMessage = await prisma.conversation.findFirst({
        where: { userId, role: 'user', createdAt: { gte: inactivityCutoff } },
        select: { id: true },
      })
      if (recentMessage) continue  // user is active, skip

      const phone = await getPhone(prisma, userId)
      if (!phone) continue

      const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
      const accessToken = config.WHATSAPP_ACCESS_TOKEN
      if (!phoneNumberId || !accessToken) continue

      const insight = await getInsight(prisma, userId)
      const msg = buildMessage(insight)

      await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)

      await prisma.auditLog.create({
        data: {
          userId,
          eventType: 'inactivity_nudge_sent',
          eventData: { inactiveDays: INACTIVITY_DAYS },
        },
      })

      nudged++
      logger.info({ userId }, 'Inactivity nudge sent')
    } catch (err) {
      logger.error({ err, userId }, 'Inactivity nudge failed for user')
      errors++
    }
  }

  return { processed: activeUsers.length, nudged, errors }
}
