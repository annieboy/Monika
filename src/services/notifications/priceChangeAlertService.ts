/**
 * Recurring payment price-change alert service.
 *
 * Runs daily. For each user with active recurring payments, checks whether
 * the most recent occurrence of each payment deviated significantly from the
 * typical amount (>10% increase). Sends a proactive WhatsApp alert.
 *
 * Rate-limited: one alert per merchant per calendar month via auditLog.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface PriceChangeAlertResult {
  processed: number
  alerted: number
  errors: number
}

const PRICE_INCREASE_THRESHOLD = 0.10  // 10%
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

async function wasAlertedThisMonth(
  prisma: PrismaClient,
  userId: string,
  merchantSlug: string,
): Promise<boolean> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const hit = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'price_change_alert_sent',
      eventData: { path: ['merchantSlug'], equals: merchantSlug },
      createdAt: { gte: startOfMonth },
    },
    select: { id: true },
  })
  return !!hit
}

function buildMessage(merchantName: string, typicalAmount: number, newAmount: number): string {
  const increase = newAmount - typicalAmount
  const pct = Math.round((increase / typicalAmount) * 100)
  return (
    `📈 *Price increase detected — ${merchantName}*\n\n` +
    `Your latest payment was *${fmt(newAmount)}* — that's *${pct}% more* than usual (${fmt(typicalAmount)}).\n\n` +
    `Worth checking if your plan changed, or if there's a better deal available.\n\n` +
    `Reply *"should I switch broadband?"* or *"best mobile plan?"* and I'll check the market for you.`
  )
}

export async function runPriceChangeAlertBatch(prisma: PrismaClient): Promise<PriceChangeAlertResult> {
  const activeUsers = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active' },
    distinct: ['userId'],
    select: { userId: true },
  })

  let alerted = 0
  let errors = 0

  for (const { userId } of activeUsers) {
    try {
      const recurring = await prisma.recurringPayment.findMany({
        where: { userId, isActive: true },
        select: {
          merchantName: true,
          merchantSlug: true,
          typicalAmount: true,
        },
      })

      const increases: Array<{ merchantName: string; merchantSlug: string; typicalAmount: number; lastAmount: number }> = []
      for (const r of recurring) {
        const typical = Number(r.typicalAmount)
        if (typical <= 0) continue
        const lastTx = await prisma.transaction.findFirst({
          where: { userId, merchantNameClean: r.merchantName, isRecurring: true },
          orderBy: { transactionDate: 'desc' },
          select: { amount: true },
        })
        if (!lastTx) continue
        const lastAmount = Math.abs(Number(lastTx.amount))
        if (lastAmount > typical * (1 + PRICE_INCREASE_THRESHOLD)) {
          increases.push({ merchantName: r.merchantName, merchantSlug: r.merchantSlug, typicalAmount: typical, lastAmount })
        }
      }

      if (increases.length === 0) continue

      const phone = await getPhone(prisma, userId)
      if (!phone) continue

      const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
      const accessToken = config.WHATSAPP_ACCESS_TOKEN
      if (!phoneNumberId || !accessToken) continue

      for (const r of increases) {
        if (await wasAlertedThisMonth(prisma, userId, r.merchantSlug)) continue

        const msg = buildMessage(r.merchantName, r.typicalAmount, r.lastAmount)

        await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)

        await prisma.auditLog.create({
          data: {
            userId,
            eventType: 'price_change_alert_sent',
            eventData: {
              merchantSlug: r.merchantSlug,
              merchantName: r.merchantName,
              typicalAmount: r.typicalAmount,
              newAmount: r.lastAmount,
            },
          },
        })

        alerted++
        logger.info({ userId, merchant: r.merchantSlug }, 'Price change alert sent')
      }
    } catch (err) {
      logger.error({ err, userId }, 'Price change alert failed for user')
      errors++
    }
  }

  return { processed: activeUsers.length, alerted, errors }
}
