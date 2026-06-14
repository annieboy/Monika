/**
 * Anomaly alert service.
 *
 * Sends WhatsApp alerts for high-scoring anomaly transactions.
 * Rate-limited to one alert per user per day.
 *
 * Alert criteria:
 *   - anomalyScore >= 0.75
 *   - transactionDate >= 48 hours ago
 *   - Max 3 anomalies per user per alert
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

const ANOMALY_THRESHOLD = 0.75
const MAX_PER_ALERT = 3

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

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

async function isRateLimited(prisma: PrismaClient, userId: string): Promise<boolean> {
  const existing = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'anomaly_alert_sent',
      createdAt: { gte: startOfToday() },
    },
    select: { id: true },
  })
  return existing !== null
}

interface AnomalyTx {
  id: string
  userId: string
  amount: unknown
  merchantName: string | null
  merchantNameClean: string | null
  transactionDate: Date
  anomalyScore: unknown
}

function formatAmount(amount: unknown): string {
  const n = Math.abs(Number(amount))
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function buildMessage(txs: AnomalyTx[]): string {
  const bullets = txs.map((tx) => {
    const merchant = tx.merchantNameClean ?? tx.merchantName ?? 'Unknown merchant'
    const amt = formatAmount(tx.amount)
    const score = Number(tx.anomalyScore)
    let reason = 'unusual activity'
    if (score >= 0.9) reason = 'possible duplicate'
    else if (score >= 0.8) reason = 'unusual amount or new subscription'
    else if (score >= 0.75) reason = 'unusual pattern'
    return `• ${merchant} — ${amt} (${reason})`
  })

  return (
    `🔍 *Unusual activity detected*\n\n` +
    `I've spotted some transactions worth reviewing:\n` +
    bullets.join('\n') +
    `\n\nReply *"show me"* to see details, or ignore if these are expected.`
  )
}

export async function runAnomalyAlertBatch(
  prisma: PrismaClient,
): Promise<{ alerted: number; errors: number }> {
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = config.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) {
    logger.warn('No WhatsApp config, skipping anomaly alert batch')
    return { alerted: 0, errors: 0 }
  }

  const cutoff = new Date(Date.now() - 48 * 3_600_000)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawTxs = (await (prisma.transaction.findMany as any)({
    where: {
      anomalyScore: { gte: ANOMALY_THRESHOLD },
      transactionDate: { gte: cutoff },
    },
    select: {
      id: true,
      userId: true,
      amount: true,
      merchantName: true,
      merchantNameClean: true,
      transactionDate: true,
      anomalyScore: true,
    },
    orderBy: { anomalyScore: 'desc' },
  })) as AnomalyTx[]

  if (rawTxs.length === 0) return { alerted: 0, errors: 0 }

  // Group by userId, take top 3
  const byUser = new Map<string, AnomalyTx[]>()
  for (const tx of rawTxs) {
    const list = byUser.get(tx.userId) ?? []
    if (list.length < MAX_PER_ALERT) {
      list.push(tx)
      byUser.set(tx.userId, list)
    }
  }

  let alerted = 0
  let errors = 0

  for (const [userId, userTxs] of byUser) {
    try {
      const limited = await isRateLimited(prisma, userId)
      if (limited) {
        logger.debug({ userId }, 'Anomaly alert rate-limited for user')
        continue
      }

      const phone = await getPhone(prisma, userId)
      if (!phone) {
        logger.debug({ userId }, 'No phone for anomaly alert')
        continue
      }

      const msg = buildMessage(userTxs)
      await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)

      await prisma.auditLog.create({
        data: {
          userId,
          eventType: 'anomaly_alert_sent',
          serviceName: 'anomaly-alerts',
          eventData: { transactionIds: userTxs.map((t) => t.id) },
        },
      })

      logger.info({ userId, count: userTxs.length }, 'Anomaly alert sent')
      alerted++
    } catch (err) {
      errors++
      logger.error({ err, userId }, 'Failed to send anomaly alert')
    }
  }

  logger.info({ alerted, errors }, 'Anomaly alert batch complete')
  return { alerted, errors }
}
