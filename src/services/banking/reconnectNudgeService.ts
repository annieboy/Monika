/**
 * Bank reconnection nudge service.
 *
 * When a bank connection has been in 'error' state for 3+ days (i.e. token
 * refresh has failed repeatedly), the user is sent a WhatsApp message with a
 * fresh one-time reconnection link. Without this, users silently stop seeing
 * data and don't know why.
 *
 * Rate-limited: one nudge per connection per 7 days, tracked via audit_log.
 */
import type { PrismaClient } from '@prisma/client'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { generateOnboardingToken } from '../onboarding/token.js'
import { logConsentEvent } from '../onboarding/audit.js'
import { config } from '../../config.js'
import { decrypt } from '../../lib/crypto.js'
import { logger } from '../../logger.js'

const ERROR_GRACE_DAYS = 3      // how long to wait before nudging
const NUDGE_RATE_LIMIT_DAYS = 7 // minimum days between nudges for same connection

export interface ReconnectNudgeResult {
  nudged: number
  errors: number
}

async function wasNudgedRecently(
  prisma: PrismaClient,
  userId: string,
  connectionId: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - NUDGE_RATE_LIMIT_DAYS * 86_400_000)
  const hit = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'bank_reconnect_nudge_sent',
      eventData: { path: ['connectionId'], equals: connectionId },
      createdAt: { gt: cutoff },
    },
    select: { id: true },
  })
  return !!hit
}

async function getPhone(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappPhoneEnc: true },
  })
  if (!user?.whatsappPhoneEnc) return null
  return decrypt(Buffer.from(user.whatsappPhoneEnc), config.ENCRYPTION_KEY).toString('utf-8')
}

export async function runReconnectNudgeBatch(prisma: PrismaClient): Promise<ReconnectNudgeResult> {
  const errorCutoff = new Date(Date.now() - ERROR_GRACE_DAYS * 86_400_000)

  // Find connections that have been failing for ERROR_GRACE_DAYS+ days
  const failing = await prisma.bankConnection.findMany({
    where: {
      consentStatus: 'active',
      lastSyncStatus: 'error',
      updatedAt: { lt: errorCutoff },
    },
    select: { id: true, userId: true, bankDisplayName: true },
  })

  let nudged = 0
  let errors = 0

  for (const conn of failing) {
    try {
      if (await wasNudgedRecently(prisma, conn.userId, conn.id)) continue

      const phone = await getPhone(prisma, conn.userId)
      if (!phone) continue

      const token = await generateOnboardingToken(prisma, conn.userId)
      const link = `${config.APP_BASE_URL}/banking/start?token=${token}`

      const msg =
        `⚠️ *Action needed: reconnect your ${conn.bankDisplayName} account*\n\n` +
        `We haven't been able to sync your transactions for a few days — your bank connection may need refreshing.\n\n` +
        `Tap this link to reconnect (expires in 15 minutes):\n${link}\n\n` +
        `Once reconnected, your data will update automatically.`

      await sendWhatsAppMessage(phone, msg, config.WHATSAPP_PHONE_NUMBER_ID, config.WHATSAPP_ACCESS_TOKEN)
      await logConsentEvent(prisma, 'bank_reconnect_nudge_sent', conn.userId, { connectionId: conn.id, bank: conn.bankDisplayName })

      nudged++
    } catch (err) {
      errors++
      logger.error({ err, connectionId: conn.id, userId: conn.userId }, 'Reconnect nudge failed')
    }
  }

  return { nudged, errors }
}
