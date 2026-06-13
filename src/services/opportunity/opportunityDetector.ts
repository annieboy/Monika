/**
 * Opportunity Detector — matches users to affiliate offers.
 *
 * Two detection paths:
 *
 * 1. Bank-linked users:
 *    - recurring_expense_match: RecurringPayment → competing Offer
 *    - balance_analysis: idle current account balance → savings account Offer
 *
 * 2. No-bank users (requiresBankLink = false offers only):
 *    - no_bank_profile: surface generic offers (savings, accounting, etc.)
 *      based on conversation signals or onboarding profile only
 *
 * Skips offers already DISMISSED or CONVERTED for this user.
 */
import type { PrismaClient } from '@prisma/client'

export interface OpportunityInput {
  userId: string
  offerId: string
  recurringPaymentId?: string
  detectionMethod: string
  annualSavingEstimate?: number
  savingConfidence: number
}

export async function detectOpportunities(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const hasBankConnection = await prisma.bankConnection.count({
    where: { userId, consentStatus: 'active' },
  })

  let count = 0

  if (hasBankConnection > 0) {
    count += await detectFromRecurringPayments(prisma, userId)
    count += await detectFromBalances(prisma, userId)
  } else {
    count += await detectForNoBankUser(prisma, userId)
  }

  return count
}

async function detectFromRecurringPayments(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const recurringPayments = await prisma.recurringPayment.findMany({
    where: { userId, isActive: true },
  })

  let count = 0
  for (const rp of recurringPayments) {
    const offers = await prisma.offer.findMany({
      where: {
        isActive: true,
        requiresBankLink: true,
        OR: [
          { targetMerchantSlugs: { has: rp.merchantSlug } },
          { targetCategories: { has: rp.merchantCategory } },
        ],
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
        ],
      },
      include: { category: true },
    })

    for (const offer of offers) {
      const saving = estimateSaving(Number(rp.averageAmount), offer)
      if (saving.annual <= 0) continue

      await upsertOpportunity(prisma, {
        userId,
        offerId: offer.id,
        recurringPaymentId: rp.id,
        detectionMethod: 'recurring_expense_match',
        annualSavingEstimate: saving.annual,
        savingConfidence: rp.cadenceConfidence * saving.confidenceMultiplier,
      })
      count++
    }
  }
  return count
}

async function detectFromBalances(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const accounts = await prisma.account.findMany({
    where: { userId, isActive: true, accountType: 'current' },
  })

  let count = 0
  for (const account of accounts) {
    const balance = Number(account.currentBalance ?? 0)
    if (balance < 1000) continue

    const savingsOffers = await prisma.offer.findMany({
      where: {
        isActive: true,
        category: { slug: 'savings' },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
      orderBy: { commissionValue: 'desc' },
      take: 3,
    })

    for (const offer of savingsOffers) {
      const params = offer.parameters as { aer?: number }
      const aer = params?.aer ?? 0
      const annualInterest = balance * (aer / 100)
      if (annualInterest <= 0) continue

      await upsertOpportunity(prisma, {
        userId,
        offerId: offer.id,
        detectionMethod: 'balance_analysis',
        annualSavingEstimate: annualInterest,
        savingConfidence: 0.9,
      })
      count++
    }
  }
  return count
}

// Surface offers that don't require a bank link — available to all users
async function detectForNoBankUser(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const offers = await prisma.offer.findMany({
    where: {
      isActive: true,
      requiresBankLink: false,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
      ],
    },
  })

  let count = 0
  for (const offer of offers) {
    await upsertOpportunity(prisma, {
      userId,
      offerId: offer.id,
      detectionMethod: 'no_bank_profile',
      savingConfidence: 0.4, // lower confidence — no transaction data to back it
    })
    count++
  }
  return count
}

async function upsertOpportunity(
  prisma: PrismaClient,
  input: OpportunityInput,
): Promise<void> {
  const existing = await prisma.opportunity.findUnique({
    where: { userId_offerId: { userId: input.userId, offerId: input.offerId } },
  })

  // Never re-surface something the user already converted or explicitly dismissed
  if (existing?.status === 'CONVERTED' || existing?.status === 'DISMISSED') return

  if (existing) {
    await prisma.opportunity.update({
      where: { id: existing.id },
      data: {
        ...(input.annualSavingEstimate != null ? { annualSavingEstimate: input.annualSavingEstimate } : {}),
        savingConfidence: input.savingConfidence,
        status: 'PENDING',
      },
    })
  } else {
    await prisma.opportunity.create({
      data: {
        userId: input.userId,
        offerId: input.offerId,
        recurringPaymentId: input.recurringPaymentId ?? null,
        detectionMethod: input.detectionMethod,
        ...(input.annualSavingEstimate != null ? { annualSavingEstimate: input.annualSavingEstimate } : {}),
        savingConfidence: input.savingConfidence,
        status: 'PENDING',
      },
    })
  }
}

function estimateSaving(
  currentMonthly: number,
  offer: { parameters: unknown; category: { slug: string } },
): { annual: number; confidenceMultiplier: number } {
  const params = offer.parameters as Record<string, unknown>

  switch (offer.category.slug) {
    case 'broadband':
    case 'mobile': {
      const offerMonthly = Number(params.monthlyPrice ?? 0)
      const saving = currentMonthly - offerMonthly
      return { annual: saving * 12, confidenceMultiplier: 0.85 }
    }
    case 'accounting': {
      const offerMonthly = Number(params.monthlyPrice ?? 0)
      const saving = currentMonthly - offerMonthly
      return { annual: saving * 12, confidenceMultiplier: 0.80 }
    }
    default:
      return { annual: 0, confidenceMultiplier: 0 }
  }
}
