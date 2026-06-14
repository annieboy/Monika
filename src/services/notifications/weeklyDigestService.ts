/**
 * Weekly financial digest.
 *
 * Every Sunday at 09:00 UTC, sends each user with an active bank connection
 * a WhatsApp summary of the past 7 days:
 *   - Total spend
 *   - Top spending category
 *   - Comparison vs the prior week
 *   - A personalised money tip
 *
 * Rate-limited to once per 6 days via audit log to prevent duplicate sends
 * on retries.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface WeeklyDigestResult {
  sent: number
  errors: number
}

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000

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

function buildDigest(
  thisWeekSpend: number,
  lastWeekSpend: number,
  topCategory: string | null,
  topCategorySpend: number,
): string {
  const diff = thisWeekSpend - lastWeekSpend
  const diffStr =
    diff > 0
      ? `📈 ${fmt(diff)} more than last week`
      : diff < 0
      ? `📉 ${fmt(Math.abs(diff))} less than last week`
      : `same as last week`

  let msg = `📊 *Your weekly money summary*\n\n`
  msg += `You spent *${fmt(thisWeekSpend)}* this week — ${diffStr}.\n\n`

  if (topCategory) {
    msg += `🏆 Biggest category: *${topCategory}* (${fmt(topCategorySpend)})\n\n`
  }

  // Simple rotating tip based on day of year
  const tips = [
    `💡 Try the 48-hour rule: wait 2 days before any non-essential purchase.`,
    `💡 Review your subscriptions — the average UK household pays for 4 they never use.`,
    `💡 Cooking at home 3 extra times a week can save £150+/month.`,
    `💡 Set up a standing order on payday to move savings before you can spend them.`,
    `💡 Check if your energy tariff is still competitive — switching saves £200/year on average.`,
  ]
  const tip = tips[new Date().getDay() % tips.length] ?? tips[0]!
  msg += `${tip}\n\n`
  msg += `Say *"my spending"* to see the full breakdown.`

  return msg
}

export async function runWeeklyDigestBatch(prisma: PrismaClient): Promise<WeeklyDigestResult> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000)

  // Only users with active bank connections and completed onboarding
  const users = await prisma.user.findMany({
    where: {
      bankConnections: { some: { consentStatus: 'active' } },
      termsAcceptedAt: { not: null },
    },
    select: { id: true },
  })

  let sent = 0
  let errors = 0

  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = config.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) {
    logger.warn('Weekly digest: WhatsApp credentials not configured, skipping')
    return { sent: 0, errors: 0 }
  }

  for (const user of users) {
    try {
      // Rate limit — skip if sent within last 6 days
      const lastSent = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          eventType: 'weekly_digest_sent',
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      if (lastSent && now.getTime() - lastSent.createdAt.getTime() < SIX_DAYS_MS) continue

      // This week spend
      const thisWeekRows = await prisma.transaction.aggregate({
        where: {
          userId: user.id,
          transactionDate: { gte: sevenDaysAgo, lt: now },
          amount: { lt: 0 },
        },
        _sum: { amount: true },
      })
      const thisWeekSpend = Math.abs(Number(thisWeekRows._sum.amount ?? 0))
      if (thisWeekSpend === 0) continue // no activity, skip

      // Last week spend (for comparison)
      const lastWeekRows = await prisma.transaction.aggregate({
        where: {
          userId: user.id,
          transactionDate: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
          amount: { lt: 0 },
        },
        _sum: { amount: true },
      })
      const lastWeekSpend = Math.abs(Number(lastWeekRows._sum.amount ?? 0))

      // Top category this week
      const categoryRows = await prisma.transaction.groupBy({
        by: ['category'],
        where: {
          userId: user.id,
          transactionDate: { gte: sevenDaysAgo, lt: now },
          amount: { lt: 0 },
          category: { not: null },
        },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'asc' } }, // most negative = biggest spend
        take: 1,
      })
      const topRow = categoryRows[0]
      const topCategory = topRow?.category ?? null
      const topCategorySpend = Math.abs(Number(topRow?._sum?.amount ?? 0))

      const phone = await getPhone(prisma, user.id)
      if (!phone) continue

      const message = buildDigest(thisWeekSpend, lastWeekSpend, topCategory, topCategorySpend)
      await sendWhatsAppMessage(phone, message, phoneNumberId, accessToken)

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          eventType: 'weekly_digest_sent',
          serviceName: 'notifications',
          eventData: { thisWeekSpend, lastWeekSpend, topCategory },
        },
      })

      sent++
      logger.info({ userId: user.id }, 'Weekly digest sent')
    } catch (err) {
      errors++
      logger.error({ err, userId: user.id }, 'Weekly digest failed for user')
    }
  }

  return { sent, errors }
}
