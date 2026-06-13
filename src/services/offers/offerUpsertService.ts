/**
 * Offer upsert service — idempotent ingestion from any source.
 *
 * Match key: (providerSlug, categoryId, affiliateProgramId)
 * On match: update mutable fields, never overwrite manually-curated content.
 * On miss: create new offer.
 */
import type { PrismaClient, AffiliateNetwork, CommissionType } from '@prisma/client'

export interface OfferInput {
  providerName: string
  providerSlug: string
  providerLogoUrl?: string
  categorySlug: string
  title: string
  shortDescription: string
  keyBenefits?: string[]
  keyTerms?: string[]
  parameters: Record<string, unknown>
  affiliateNetwork: AffiliateNetwork
  affiliateProgramId: string
  affiliateBaseUrl: string
  commissionType: CommissionType
  commissionValue: number
  commissionCurrency?: string
  cookieDurationDays?: number
  targetMerchantSlugs?: string[]
  targetCategories?: string[]
  minMonthlySpend?: number
  maxMonthlySpend?: number
  requiresBankLink?: boolean
  fcaDisclaimer?: string
  isRegulated?: boolean
  regulatoryBody?: string
  expiresAt?: Date
  startsAt?: Date
  refreshIntervalHours?: number
}

export interface UpsertResult {
  id: string
  action: 'created' | 'updated' | 'skipped'
}

export async function upsertOffer(
  prisma: PrismaClient,
  input: OfferInput,
): Promise<UpsertResult> {
  const category = await prisma.offerCategory.findUnique({
    where: { slug: input.categorySlug },
  })
  if (!category) {
    throw new Error(`Unknown offer category: ${input.categorySlug}`)
  }

  const existing = await prisma.offer.findFirst({
    where: {
      providerSlug: input.providerSlug,
      categoryId: category.id,
      affiliateProgramId: input.affiliateProgramId,
    },
  })

  const mutableData = {
    providerName: input.providerName,
    ...(input.providerLogoUrl !== undefined ? { providerLogoUrl: input.providerLogoUrl } : {}),
    parameters: input.parameters as object,
    commissionType: input.commissionType,
    commissionValue: input.commissionValue,
    commissionCurrency: input.commissionCurrency ?? 'GBP',
    cookieDurationDays: input.cookieDurationDays ?? 30,
    affiliateBaseUrl: input.affiliateBaseUrl,
    expiresAt: input.expiresAt ?? null,
    startsAt: input.startsAt ?? null,
    lastRefreshedAt: new Date(),
    refreshIntervalHours: input.refreshIntervalHours ?? 24,
    isActive: true,
  }

  if (existing) {
    await prisma.offer.update({
      where: { id: existing.id },
      data: mutableData,
    })
    return { id: existing.id, action: 'updated' }
  }

  const created = await prisma.offer.create({
    data: {
      categoryId: category.id,
      providerName: input.providerName,
      providerSlug: input.providerSlug,
      providerLogoUrl: input.providerLogoUrl ?? null,
      title: input.title,
      shortDescription: input.shortDescription,
      keyBenefits: input.keyBenefits ?? [],
      keyTerms: input.keyTerms ?? [],
      parameters: input.parameters as object,
      affiliateNetwork: input.affiliateNetwork,
      affiliateProgramId: input.affiliateProgramId,
      affiliateBaseUrl: input.affiliateBaseUrl,
      commissionType: input.commissionType,
      commissionValue: input.commissionValue,
      commissionCurrency: input.commissionCurrency ?? 'GBP',
      cookieDurationDays: input.cookieDurationDays ?? 30,
      targetMerchantSlugs: input.targetMerchantSlugs ?? [],
      targetCategories: input.targetCategories ?? [],
      minMonthlySpend: input.minMonthlySpend ?? null,
      maxMonthlySpend: input.maxMonthlySpend ?? null,
      requiresBankLink: input.requiresBankLink ?? false,
      fcaDisclaimer: input.fcaDisclaimer ?? null,
      isRegulated: input.isRegulated ?? false,
      regulatoryBody: input.regulatoryBody ?? null,
      expiresAt: input.expiresAt ?? null,
      startsAt: input.startsAt ?? null,
      refreshIntervalHours: input.refreshIntervalHours ?? 24,
      isActive: true,
    },
  })

  return { id: created.id, action: 'created' }
}

export async function expireStaleOffers(prisma: PrismaClient): Promise<number> {
  const result = await prisma.offer.updateMany({
    where: {
      isActive: true,
      expiresAt: { lt: new Date() },
    },
    data: { isActive: false },
  })
  return result.count
}
