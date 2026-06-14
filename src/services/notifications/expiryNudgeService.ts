/**
 * Opportunity expiry nudge notifications.
 *
 * Finds DELIVERED opportunities expiring within 48 hours that the user
 * hasn't clicked yet, and sends a "this offer expires soon" WhatsApp reminder.
 *
 * Rate-limited: only one nudge per opportunity (tracked via audit log).
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { generateClickUrl } from '../affiliate/clickTrackingService.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface ExpiryNudgeResult {
  nudged: number
  errors: number
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

export async function runExpiryNudgeBatch(prisma: PrismaClient): Promise<ExpiryNudgeResult> {
  const now = new Date()
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)

  // Opportunities delivered but not yet clicked, expiring within 48h
  const opportunities = await prisma.opportunity.findMany({
    where: {
      status: 'DELIVERED',
      clickedAt: null,
      expiresAt: { gte: now, lte: in48h },
    },
    select: {
      id: true,
      userId: true,
      offerId: true,
      expiresAt: true,
      offer: { select: { title: true, providerName: true, shortDescription: true } },
    },
  })

  let nudged = 0
  let errors = 0

  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = config.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) return { nudged: 0, errors: 0 }

  for (const opp of opportunities) {
    try {
      // Skip if already nudged for this opportunity
      const alreadyNudged = await prisma.auditLog.findFirst({
        where: {
          userId: opp.userId,
          eventType: 'expiry_nudge_sent',
          eventData: { path: ['opportunityId'], equals: opp.id },
        },
        select: { id: true },
      })
      if (alreadyNudged) continue

      const phone = await getPhone(prisma, opp.userId)
      if (!phone) continue

      // Generate a fresh click URL
      const clickUrl = await generateClickUrl(prisma, opp.userId, opp.offerId, opp.id)

      const hoursLeft = Math.round((opp.expiresAt!.getTime() - now.getTime()) / 3_600_000)
      const message =
        `⏰ *Last chance!* Your *${opp.offer.providerName}* offer expires in ${hoursLeft} hours.\n\n` +
        `*${opp.offer.title}*\n${opp.offer.shortDescription}\n\n` +
        `👉 ${clickUrl}\n\n` +
        `Reply *DISMISS* if you're not interested.`

      await sendWhatsAppMessage(phone, message, phoneNumberId, accessToken)

      await prisma.auditLog.create({
        data: {
          userId: opp.userId,
          eventType: 'expiry_nudge_sent',
          serviceName: 'notifications',
          eventData: { opportunityId: opp.id, offerId: opp.offerId, hoursLeft },
        },
      })

      nudged++
      logger.info({ userId: opp.userId, opportunityId: opp.id, hoursLeft }, 'Expiry nudge sent')
    } catch (err) {
      errors++
      logger.error({ err, opportunityId: opp.id }, 'Expiry nudge failed')
    }
  }

  return { nudged, errors }
}
