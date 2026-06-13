/**
 * Handles user replies to proactive opportunity messages.
 *
 * Intercepts inbound messages BEFORE the main intent classifier when the user
 * has a DELIVERED opportunity awaiting a response (within 24h window).
 *
 * Reply map (normalised, case-insensitive):
 *   1 / YES / SHOW ME / MORE DETAILS → detail view + affiliate link
 *   2 / NO / NOT INTERESTED / DISMISS → dismiss opportunity
 *   3 / MORE / MORE OPTIONS → show alternative offers in same category
 *   STOP / UNSUBSCRIBE / OPT OUT → record opt-out, suppress all future messages
 *   <month> <year> (e.g. "March 2026") → schedule reminder for mobile contracts
 *
 * Returns null if the message is not an opportunity reply — caller falls through
 * to the main intent router.
 */
import type { PrismaClient } from '@prisma/client'
import { isOptOutMessage, recordOptOut, recordOptIn } from '../compliance/consentService.js'
import { buildDetailMessage, CONSENT_CONFIRMED, CONSENT_DECLINED } from '../opportunity/opportunityMessageBuilder.js'
import { generateClickUrl } from '../affiliate/clickTrackingService.js'

const REPLY_WINDOW_HOURS = 24

// ── Reply classification ────────────────────────────────────────────────────

type OpportunityReply =
  | 'DETAIL'     // user wants to see the full offer
  | 'DISMISS'    // user not interested
  | 'MORE'       // show alternative offers in same category
  | 'OPT_OUT'    // stop all opportunity messages
  | 'OPT_IN'     // consent to opportunity messages
  | 'REMIND'     // set a future reminder (mobile contract)
  | 'UNKNOWN'    // not an opportunity reply

const DETAIL_PATTERNS = /^(1|yes|show me|show details?|tell me more|more details?|interested|ok|okay|sure|go ahead)$/i
const DISMISS_PATTERNS = /^(2|no|no thanks|not interested|dismiss|skip|nope|not for me)$/i
const MORE_PATTERNS = /^(3|more|more options?|other options?|alternatives?|show more|others?)$/i
const OPT_IN_PATTERNS = /^(yes|yeah|yep|ok|okay|sure|sign me up|opt.?in)$/i
const REMIND_PATTERN = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i

function classifyReply(text: string, inConsentFlow: boolean): OpportunityReply {
  const trimmed = text.trim()

  if (isOptOutMessage(trimmed)) return 'OPT_OUT'

  if (inConsentFlow) {
    if (OPT_IN_PATTERNS.test(trimmed)) return 'OPT_IN'
    if (DISMISS_PATTERNS.test(trimmed)) return 'DISMISS'
    return 'UNKNOWN'
  }

  if (DETAIL_PATTERNS.test(trimmed)) return 'DETAIL'
  if (DISMISS_PATTERNS.test(trimmed)) return 'DISMISS'
  if (MORE_PATTERNS.test(trimmed)) return 'MORE'
  if (REMIND_PATTERN.test(trimmed)) return 'REMIND'

  return 'UNKNOWN'
}

function parseReminderDate(text: string): Date | null {
  const match = text.match(/^(\w+)\s+(\d{4})$/i)
  if (!match) return null
  const date = new Date(`${match[1]} 1 ${match[2]}`)
  return isNaN(date.getTime()) ? null : date
}

// ── Pending opportunity lookup ──────────────────────────────────────────────

async function getMostRecentDeliveredOpportunity(
  prisma: PrismaClient,
  userId: string,
) {
  const cutoff = new Date(Date.now() - REPLY_WINDOW_HOURS * 3_600_000)
  return prisma.opportunity.findFirst({
    where: {
      userId,
      status: 'DELIVERED',
      deliveredAt: { gte: cutoff },
    },
    orderBy: { deliveredAt: 'desc' },
    include: { offer: { include: { category: true } }, recurringPayment: true },
  })
}

async function getAlternativeOffers(
  prisma: PrismaClient,
  categorySlug: string,
  excludeOfferId: string,
) {
  return prisma.offer.findMany({
    where: {
      isActive: true,
      category: { slug: categorySlug },
      id: { not: excludeOfferId },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    take: 3,
    orderBy: { commissionValue: 'desc' },
    include: { category: true },
  })
}

// ── Handler ─────────────────────────────────────────────────────────────────

export interface OpportunityHandlerResult {
  handled: boolean
  response: string
}

export async function handleOpportunityReply(
  prisma: PrismaClient,
  userId: string,
  text: string,
): Promise<OpportunityHandlerResult> {
  // Check if user is in consent flow (no preference record yet)
  const prefs = await prisma.userOpportunityPreferences.findUnique({ where: { userId } })
  const inConsentFlow = !prefs // No prefs = we haven't got consent yet

  // Global opt-out always handled regardless of state
  if (isOptOutMessage(text.trim())) {
    await recordOptOut(prisma, userId)
    return {
      handled: true,
      response: `✅ Got it — I've removed you from savings suggestions. You can still ask me anything about your finances directly.\n\n_Reply YES at any time to opt back in._`,
    }
  }

  // Consent flow handling
  if (inConsentFlow) {
    const reply = classifyReply(text, true)
    if (reply === 'OPT_IN') {
      await recordOptIn(prisma, userId)
      return { handled: true, response: CONSENT_CONFIRMED }
    }
    if (reply === 'DISMISS') {
      return { handled: true, response: CONSENT_DECLINED }
    }
    return { handled: false, response: '' } // not a consent reply — fall through
  }

  // Opportunity reply handling — only if there's a recent delivered opportunity
  const recentOpp = await getMostRecentDeliveredOpportunity(prisma, userId)
  if (!recentOpp) return { handled: false, response: '' }

  const reply = classifyReply(text, false)
  if (reply === 'UNKNOWN') return { handled: false, response: '' }

  const offer = recentOpp.offer

  switch (reply) {
    case 'DETAIL': {
      const affiliateUrl = await generateClickUrl(prisma, userId, offer.id, recentOpp.id)
      const detailMsg = buildDetailMessage({
        categorySlug: offer.category.slug,
        providerName: offer.providerName,
        title: offer.title,
        shortDescription: offer.shortDescription,
        keyBenefits: offer.keyBenefits,
        parameters: offer.parameters as Record<string, unknown>,
        annualSavingEstimate: recentOpp.annualSavingEstimate
          ? Number(recentOpp.annualSavingEstimate)
          : null,
        currentMonthlySpend: recentOpp.recurringPayment
          ? Number(recentOpp.recurringPayment.averageAmount)
          : undefined,
        affiliateUrl,
        fcaDisclaimer: offer.fcaDisclaimer,
      })
      return { handled: true, response: detailMsg }
    }

    case 'DISMISS': {
      await prisma.opportunity.update({
        where: { id: recentOpp.id },
        data: { status: 'DISMISSED', dismissedAt: new Date(), dismissReason: 'user_declined' },
      })
      return {
        handled: true,
        response: `No problem! I won't mention that again.\n\nFeel free to ask me anything else about your finances.`,
      }
    }

    case 'MORE': {
      const alternatives = await getAlternativeOffers(prisma, offer.category.slug, offer.id)
      if (alternatives.length === 0) {
        return {
          handled: true,
          response: `I don't have other ${offer.category.name} options right now, but I'll let you know when new deals become available.`,
        }
      }
      const lines = [`Here are some other *${offer.category.name}* options:\n`]
      alternatives.forEach((alt, i) => {
        const p = alt.parameters as Record<string, unknown>
        const price = p.monthlyPrice ? `£${p.monthlyPrice}/mo` : p.aer ? `${p.aer}% AER` : ''
        lines.push(`*${i + 1}.* ${alt.providerName} — ${alt.title}${price ? ` — ${price}` : ''}`)
      })
      lines.push(`\nReply *1*, *2*, or *3* for details on any of these.`)
      // Store alternatives in session for follow-up (simple approach: update opportunity metadata)
      return { handled: true, response: lines.join('\n') }
    }

    case 'REMIND': {
      const remindDate = parseReminderDate(text.trim())
      if (!remindDate) {
        return {
          handled: true,
          response: `I didn't catch that date. Reply with month and year like *March 2026* and I'll remind you then.`,
        }
      }
      // Mark opportunity as suppressed until reminder date
      await prisma.opportunity.update({
        where: { id: recentOpp.id },
        data: {
          status: 'SUPPRESSED',
          scheduledDeliveryAt: remindDate,
          complianceFlags: ['REMINDER_SET'],
        },
      })
      const monthName = remindDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
      return {
        handled: true,
        response: `Got it! I'll remind you in *${monthName}* with the best ${offer.category.name} deals available then.\n\nReply *DEALS* anytime to see current offers.`,
      }
    }

    default:
      return { handled: false, response: '' }
  }
}
