/**
 * Low balance alert service.
 *
 * Runs daily. For each user with an active bank connection, checks whether
 * their current balance has fallen below a threshold (default: 7 days of
 * average daily spend, minimum £100). Sends a proactive WhatsApp alert.
 *
 * Rate-limited: one alert per user per 5 days via auditLog.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface LowBalanceAlertResult {
  processed: number
  alerted: number
  errors: number
}

const MIN_DAYS_BETWEEN_ALERTS = 5
const DAYS_OF_SPEND_THRESHOLD = 7
const ABSOLUTE_MINIMUM_THRESHOLD = 100  // never alert above this if spend is low
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

async function wasAlertedRecently(prisma: PrismaClient, userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN_ALERTS * 86_400_000)
  const hit = await prisma.auditLog.findFirst({
    where: { userId, eventType: 'low_balance_alert_sent', createdAt: { gt: cutoff } },
    select: { id: true },
  })
  return !!hit
}

function buildMessage(balance: number, threshold: number, daysOfSpend: number): string {
  return (
    `⚠️ *Low balance alert*\n\n` +
    `Your current balance is *${fmt(balance)}* — that's less than ${daysOfSpend} days of typical spending (${fmt(threshold)}).\n\n` +
    `*Things to check:*\n` +
    `• Any large bills due soon? Say *"upcoming bills"* to check\n` +
    `• Transfer from savings if needed\n` +
    `• Check if any subscriptions renewed unexpectedly\n\n` +
    `Reply *"safe to spend"* if you want to know what's OK to spend today.`
  )
}

export async function runLowBalanceAlertBatch(prisma: PrismaClient): Promise<LowBalanceAlertResult> {
  const activeUsers = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active' },
    distinct: ['userId'],
    select: { userId: true },
  })

  let alerted = 0
  let errors = 0

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)

  for (const { userId } of activeUsers) {
    try {
      if (await wasAlertedRecently(prisma, userId)) continue

      const [accounts, recentSpend] = await Promise.all([
        prisma.account.findMany({
          where: { userId },
          select: { currentBalance: true, accountType: true },
        }),
        prisma.transaction.aggregate({
          where: { userId, amount: { gt: 0 }, transactionDate: { gte: thirtyDaysAgo } },
          _sum: { amount: true },
        }),
      ])

      const balance = accounts
        .filter(a => a.accountType !== 'mortgage' && a.accountType !== 'loan')
        .reduce((s, a) => s + Number(a.currentBalance ?? 0), 0)

      if (balance <= 0) continue  // skip negative balances (overdraft — different alert)

      const monthlySpend = Number((recentSpend._sum as { amount?: unknown }).amount ?? 0)
      const dailySpend = monthlySpend / 30
      const threshold = Math.max(dailySpend * DAYS_OF_SPEND_THRESHOLD, ABSOLUTE_MINIMUM_THRESHOLD)

      if (balance >= threshold) continue

      const phone = await getPhone(prisma, userId)
      if (!phone) continue

      const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
      const accessToken = config.WHATSAPP_ACCESS_TOKEN
      if (!phoneNumberId || !accessToken) continue

      const msg = buildMessage(balance, threshold, DAYS_OF_SPEND_THRESHOLD)
      await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)

      await prisma.auditLog.create({
        data: {
          userId,
          eventType: 'low_balance_alert_sent',
          eventData: { balance, threshold },
        },
      })

      alerted++
      logger.info({ userId, balance, threshold }, 'Low balance alert sent')
    } catch (err) {
      logger.error({ err, userId }, 'Low balance alert failed for user')
      errors++
    }
  }

  return { processed: activeUsers.length, alerted, errors }
}
