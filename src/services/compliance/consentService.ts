/**
 * Compliance gate for opportunity delivery.
 *
 * Checks (in order):
 *   1. User has given explicit consent for opportunity messages
 *   2. Not in a cooling-off period (post opt-out or post-dismissal)
 *   3. Weekly message cap not exceeded
 *   4. Monthly message cap not exceeded
 *   5. Not in quiet hours (default 21:00–08:00 UK time)
 *   6. Category not disabled by user
 *
 * All checks are synchronous-safe: never throws, always returns a reason.
 */
import type { PrismaClient } from '@prisma/client'

export type IneligibilityReason =
  | 'NO_CONSENT'
  | 'CONSENT_WITHDRAWN'
  | 'COOLING_OFF'
  | 'WEEKLY_CAP'
  | 'MONTHLY_CAP'
  | 'QUIET_HOURS'
  | 'CATEGORY_DISABLED'

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: IneligibilityReason; until?: Date }

export const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'NO MORE', 'OPT OUT', 'REMOVE ME']

export function isOptOutMessage(text: string): boolean {
  const upper = text.toUpperCase().trim()
  return OPT_OUT_KEYWORDS.some(k => upper === k || upper.startsWith(k + ' '))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

function isInQuietHours(start: string, end: string, now = new Date()): boolean {
  // start/end are "HH:MM" in UK time (approximate with UTC for now)
  const toMinutes = (hhmm: string) => {
    const parts = hhmm.split(':').map(Number)
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
  }
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  const startMin = toMinutes(start)
  const endMin = toMinutes(end)

  if (startMin > endMin) {
    // overnight window e.g. 21:00–08:00
    return nowMinutes >= startMin || nowMinutes < endMin
  }
  return nowMinutes >= startMin && nowMinutes < endMin
}

async function countRecentMessages(
  prisma: PrismaClient,
  userId: string,
  windowDays: number,
): Promise<number> {
  const since = new Date(Date.now() - windowDays * 86_400_000)
  return prisma.opportunity.count({
    where: {
      userId,
      deliveredAt: { gte: since },
      status: { in: ['DELIVERED', 'CLICKED', 'CONVERTED'] },
    },
  })
}

export async function checkDeliveryEligibility(
  prisma: PrismaClient,
  userId: string,
  categorySlug?: string,
): Promise<EligibilityResult> {
  const prefs = await prisma.userOpportunityPreferences.findUnique({
    where: { userId },
  })

  if (!prefs || !prefs.opportunitiesConsent) {
    return { eligible: false, reason: 'NO_CONSENT' }
  }

  if (prefs.consentWithdrawnAt) {
    return { eligible: false, reason: 'CONSENT_WITHDRAWN' }
  }

  if (prefs.coolingOffUntil && prefs.coolingOffUntil > new Date()) {
    return { eligible: false, reason: 'COOLING_OFF', until: prefs.coolingOffUntil }
  }

  if (categorySlug && prefs.disabledCategories.includes(categorySlug)) {
    return { eligible: false, reason: 'CATEGORY_DISABLED' }
  }

  const weeklyCount = await countRecentMessages(prisma, userId, 7)
  if (weeklyCount >= prefs.maxMessagesPerWeek) {
    return { eligible: false, reason: 'WEEKLY_CAP' }
  }

  const monthlyCount = await countRecentMessages(prisma, userId, 30)
  if (monthlyCount >= prefs.maxMessagesPerMonth) {
    return { eligible: false, reason: 'MONTHLY_CAP' }
  }

  if (isInQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd)) {
    return { eligible: false, reason: 'QUIET_HOURS' }
  }

  return { eligible: true }
}

export async function recordOptIn(
  prisma: PrismaClient,
  userId: string,
  method = 'whatsapp_opt_in',
): Promise<void> {
  await prisma.userOpportunityPreferences.upsert({
    where: { userId },
    create: {
      userId,
      opportunitiesConsent: true,
      consentGivenAt: new Date(),
      consentMethod: method,
    },
    update: {
      opportunitiesConsent: true,
      consentGivenAt: new Date(),
      consentMethod: method,
      consentWithdrawnAt: null,
      coolingOffUntil: null,
    },
  })
}

export async function recordOptOut(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  await prisma.userOpportunityPreferences.upsert({
    where: { userId },
    create: {
      userId,
      opportunitiesConsent: false,
      consentWithdrawnAt: new Date(),
      coolingOffUntil: addDays(new Date(), 30),
    },
    update: {
      opportunitiesConsent: false,
      consentWithdrawnAt: new Date(),
      coolingOffUntil: addDays(new Date(), 30),
    },
  })
}
