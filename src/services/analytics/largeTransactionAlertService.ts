/**
 * Large transaction alert service.
 *
 * Called after each new transaction is detected via TrueLayer webhook.
 * Checks if a transaction is unusually large compared to the user's historical
 * average for that merchant (or overall if merchant is unknown).
 *
 * Alert criteria:
 *   - Transaction amount is a debit (negative)
 *   - Amount is at least £50 absolute
 *   - Amount is > 3× the user's average for that merchant over last 6 months
 *     (or > 3× overall average spend per transaction if no merchant history)
 *
 * Rate-limited: at most one alert per user per merchant per 7 days.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export const ALERT_MULTIPLIER = 3
export const ALERT_MIN_AMOUNT = 50
const SEVEN_DAYS_MS = 7 * 86_400_000
const SIX_MONTHS_MS = 6 * 30 * 86_400_000

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

async function alreadySentRecently(
  prisma: PrismaClient,
  userId: string,
  merchant: string | null,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS)
  const existing = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'large_transaction_alert',
      ...(merchant ? { eventData: { path: ['merchant'], equals: merchant } } : {}),
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  })
  return existing !== null
}

export interface LargeTransactionAlertResult {
  alerted: boolean
  reason?: string
}

export async function checkAndAlertLargeTransaction(
  prisma: PrismaClient,
  userId: string,
  transactionId: string,
): Promise<LargeTransactionAlertResult> {
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = config.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) return { alerted: false, reason: 'no_whatsapp_config' }

  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      amount: true,
      merchantNameClean: true,
      merchantName: true,
      transactionDate: true,
    },
  })

  if (!tx) return { alerted: false, reason: 'transaction_not_found' }

  const amount = Number(tx.amount)
  if (amount >= 0) return { alerted: false, reason: 'not_a_debit' }

  const absAmount = Math.abs(amount)
  if (absAmount < ALERT_MIN_AMOUNT) return { alerted: false, reason: 'below_minimum' }

  const merchant = tx.merchantNameClean ?? tx.merchantName ?? null
  const since = new Date(Date.now() - SIX_MONTHS_MS)

  // Get historical average for this merchant (or overall)
  const historicalWhere = merchant
    ? {
        userId,
        amount: { lt: 0 },
        transactionDate: { gte: since },
        id: { not: transactionId },
        OR: [
          { merchantNameClean: { contains: merchant, mode: 'insensitive' as const } },
          { merchantName: { contains: merchant, mode: 'insensitive' as const } },
        ],
      }
    : {
        userId,
        amount: { lt: 0 },
        transactionDate: { gte: since },
        id: { not: transactionId },
      }

  const histAgg = await prisma.transaction.aggregate({
    where: historicalWhere,
    _avg: { amount: true },
    _count: { id: true },
  })

  const histCount = histAgg._count.id
  if (histCount < 3) return { alerted: false, reason: 'insufficient_history' }

  const avgAbs = Math.abs(Number(histAgg._avg.amount ?? 0))
  if (avgAbs === 0) return { alerted: false, reason: 'zero_average' }

  if (absAmount < avgAbs * ALERT_MULTIPLIER) return { alerted: false, reason: 'within_normal_range' }

  // Check rate limit
  const alreadySent = await alreadySentRecently(prisma, userId, merchant)
  if (alreadySent) return { alerted: false, reason: 'rate_limited' }

  const phone = await getPhone(prisma, userId)
  if (!phone) return { alerted: false, reason: 'no_phone' }

  const fmt = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const merchantLabel = merchant ?? 'an unknown merchant'
  const msg =
    `🔔 *Large transaction alert*\n\n` +
    `A transaction of *${fmt(absAmount)}* at *${merchantLabel}* was just processed.\n\n` +
    `This is ${Math.round(absAmount / avgAbs)}× your usual amount at this merchant (avg: ${fmt(avgAbs)}).\n\n` +
    `If you didn't make this purchase, contact your bank immediately.`

  try {
    await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)
    await prisma.auditLog.create({
      data: {
        userId,
        eventType: 'large_transaction_alert',
        serviceName: 'large-transaction-alerts',
        eventData: { transactionId, merchant, amount: absAmount, avgAmount: avgAbs },
      },
    })
    logger.info({ userId, transactionId, merchant, absAmount }, 'Large transaction alert sent')
    return { alerted: true }
  } catch (err) {
    logger.error({ err, userId, transactionId }, 'Failed to send large transaction alert')
    return { alerted: false, reason: 'send_failed' }
  }
}
