/**
 * Orchestrates proactive opportunity delivery to users via WhatsApp.
 *
 * Flow:
 *   1. Load pending/scheduled opportunities for the user
 *   2. Score + rank (one per category)
 *   3. Check compliance gate (consent, caps, quiet hours)
 *   4. Generate affiliate short link
 *   5. Build message from template
 *   6. Send via WhatsApp
 *   7. Mark opportunity as DELIVERED, update lastMessageSentAt
 *
 * Designed to be called from a BullMQ worker or the scheduler,
 * NOT from the inbound webhook — this is outbound-only.
 */
import type { PrismaClient } from '@prisma/client'
import { checkDeliveryEligibility } from '../compliance/consentService.js'
import { scoreOpportunity, rankByCategory } from './opportunityScorer.js'
import { buildOutreachMessage } from './opportunityMessageBuilder.js'
import { generateClickUrl } from '../affiliate/clickTrackingService.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { loadEngagementHistory } from './engagementHistoryService.js'

// ── Delivery spacing ────────────────────────────────────────────────────────
const MIN_HOURS_BETWEEN_MESSAGES = 48

async function getPhoneNumber(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappPhoneEnc: true },
  })
  if (!user?.whatsappPhoneEnc) return null

  const { decrypt } = await import('../../lib/crypto.js')
  return decrypt(Buffer.from(user.whatsappPhoneEnc), config.ENCRYPTION_KEY).toString('utf-8')
}

// ── Main delivery function ──────────────────────────────────────────────────

export interface DeliveryResult {
  delivered: number
  skipped: number
  reason?: string
}

export async function deliverOpportunitiesToUser(
  prisma: PrismaClient,
  userId: string,
): Promise<DeliveryResult> {
  // 1. Global eligibility check (consent, caps, quiet hours)
  const eligibility = await checkDeliveryEligibility(prisma, userId)
  if (!eligibility.eligible) {
    return { delivered: 0, skipped: 1, reason: eligibility.reason }
  }

  // 2. Enforce minimum spacing between messages
  const prefs = await prisma.userOpportunityPreferences.findUnique({ where: { userId } })
  if (prefs?.lastMessageSentAt) {
    const hoursSinceLast = (Date.now() - prefs.lastMessageSentAt.getTime()) / 3_600_000
    if (hoursSinceLast < MIN_HOURS_BETWEEN_MESSAGES) {
      return { delivered: 0, skipped: 1, reason: 'MIN_SPACING' }
    }
  }

  // 3. Load pending opportunities
  const pending = await prisma.opportunity.findMany({
    where: {
      userId,
      status: { in: ['PENDING', 'SCHEDULED'] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { offer: { include: { category: true } }, recurringPayment: true },
  })

  if (pending.length === 0) return { delivered: 0, skipped: 0 }

  // 4. Score and pick top-1 per category
  const history = await loadEngagementHistory(prisma, userId)
  const scored = pending.map(opp =>
    scoreOpportunity(
      {
        id: opp.id,
        offerId: opp.offerId,
        categorySlug: opp.offer.category.slug,
        annualSavingEstimate: opp.annualSavingEstimate ? Number(opp.annualSavingEstimate) : null,
        savingConfidence: opp.savingConfidence,
        detectedAt: opp.createdAt,
      },
      history,
    ),
  )
  const ranked = rankByCategory(scored)

  // Deliver only the top overall opportunity this run (1 per delivery cycle)
  const top = ranked[0]
  if (!top) return { delivered: 0, skipped: 0 }

  const opp = pending.find(o => o.id === top.id)!
  const offer = opp.offer

  // 5. Category-level eligibility check
  const catEligibility = await checkDeliveryEligibility(prisma, userId, offer.category.slug)
  if (!catEligibility.eligible) {
    return { delivered: 0, skipped: 1, reason: catEligibility.reason }
  }

  // 6. Get phone number
  const phone = await getPhoneNumber(prisma, userId)
  if (!phone) return { delivered: 0, skipped: 1, reason: 'NO_PHONE' }

  // 7. Generate affiliate link
  const affiliateUrl = await generateClickUrl(prisma, userId, offer.id, opp.id)

  // 8. Build message
  const { body } = buildOutreachMessage({
    categorySlug: offer.category.slug,
    providerName: offer.providerName,
    title: offer.title,
    shortDescription: offer.shortDescription,
    keyBenefits: offer.keyBenefits,
    parameters: offer.parameters as Record<string, unknown>,
    annualSavingEstimate: opp.annualSavingEstimate ? Number(opp.annualSavingEstimate) : null,
    currentMonthlySpend: opp.recurringPayment
      ? Number(opp.recurringPayment.averageAmount)
      : undefined,
    affiliateUrl,
    fcaDisclaimer: offer.fcaDisclaimer,
  })

  // 9. Send
  const { waMessageId } = await sendWhatsAppMessage(
    phone,
    body,
    config.WHATSAPP_PHONE_NUMBER_ID,
    config.WHATSAPP_ACCESS_TOKEN,
  )

  // 10. Mark delivered
  await prisma.$transaction([
    prisma.opportunity.update({
      where: { id: opp.id },
      data: { status: 'DELIVERED', deliveredAt: new Date(), waMessageId },
    }),
    prisma.userOpportunityPreferences.update({
      where: { userId },
      data: { lastMessageSentAt: new Date() },
    }),
  ])

  return { delivered: 1, skipped: ranked.length - 1 }
}

/**
 * Runs the delivery pipeline for all opted-in users with pending opportunities.
 * Called by the nightly scheduler or a BullMQ worker.
 * Errors per user are caught and logged — one failure never blocks others.
 */
export async function runDeliveryBatch(
  prisma: PrismaClient,
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
): Promise<{ processed: number; delivered: number; errors: number }> {
  const usersWithPending = await prisma.opportunity.findMany({
    where: { status: { in: ['PENDING', 'SCHEDULED'] } },
    distinct: ['userId'],
    select: { userId: true },
  })

  let delivered = 0
  let errors = 0

  for (const { userId } of usersWithPending) {
    try {
      const result = await deliverOpportunitiesToUser(prisma, userId)
      delivered += result.delivered
    } catch (err) {
      errors++
      logger.error(`Opportunity delivery failed for user ${userId}`, err)
    }
  }

  logger.info(`Delivery batch: ${usersWithPending.length} users, ${delivered} delivered, ${errors} errors`)
  return { processed: usersWithPending.length, delivered, errors }
}
