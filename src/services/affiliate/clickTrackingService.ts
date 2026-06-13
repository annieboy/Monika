/**
 * Affiliate click tracking — generates short links, handles redirects, postbacks.
 *
 * Short URL format: /r/:shortCode (8 chars, URL-safe base62)
 * Click ref format: MONIKA_{userId}_{offerId}_{timestamp}
 *
 * Never exposes userId or offerId in the short URL.
 */
import type { PrismaClient } from '@prisma/client'
import { config } from '../../config.js'

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SHORT_CODE_LENGTH = 8

function generateShortCode(): string {
  let code = ''
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += BASE62[Math.floor(Math.random() * BASE62.length)]
  }
  return code
}

function buildNetworkUrl(
  affiliateNetwork: string,
  affiliateProgramId: string,
  affiliateBaseUrl: string,
  clickRef: string,
): string {
  const awinPublisherId = config.AWIN_PUBLISHER_ID ?? ''
  const cjPublisherId = config.CJ_PUBLISHER_ID ?? ''

  switch (affiliateNetwork) {
    case 'awin':
      return `https://www.awin1.com/cread.php?awinmid=${affiliateProgramId}&awinaffid=${awinPublisherId}&clickref=${encodeURIComponent(clickRef)}&p=${encodeURIComponent(affiliateBaseUrl)}`
    case 'cj':
      return `https://www.anrdoezrs.net/click-${cjPublisherId}-${affiliateProgramId}?url=${encodeURIComponent(affiliateBaseUrl)}&sid=${encodeURIComponent(clickRef)}`
    case 'impact':
      return `${affiliateBaseUrl}?subId1=${encodeURIComponent(clickRef)}`
    case 'direct': {
      const url = new URL(affiliateBaseUrl)
      url.searchParams.set('ref', clickRef)
      return url.toString()
    }
    default:
      return affiliateBaseUrl
  }
}

export async function generateClickUrl(
  prisma: PrismaClient,
  userId: string,
  offerId: string,
  opportunityId?: string,
): Promise<string> {
  const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })

  const clickRef = `MONIKA_${userId}_${offerId}_${Date.now()}`
  const shortCode = generateShortCode()
  const redirectedToUrl = buildNetworkUrl(
    offer.affiliateNetwork,
    offer.affiliateProgramId,
    offer.affiliateBaseUrl,
    clickRef,
  )

  await prisma.affiliateClick.create({
    data: {
      userId,
      opportunityId: opportunityId ?? null,
      offerId,
      clickRef,
      shortCode,
      affiliateNetwork: offer.affiliateNetwork,
      redirectedToUrl,
      commissionStatus: 'PENDING',
    },
  })

  const baseUrl = config.APP_BASE_URL ?? 'https://monika-21wq.onrender.com'
  return `${baseUrl}/r/${shortCode}`
}

export type FraudCheckResult = { isSuspicious: false } | { isSuspicious: true; flags: string[] }

export async function checkForFraud(
  prisma: PrismaClient,
  userId: string,
  offerId: string,
  ip: string,
): Promise<FraudCheckResult> {
  const flags: string[] = []
  const oneHourAgo = new Date(Date.now() - 3_600_000)

  const recentClicksSameOffer = await prisma.affiliateClick.count({
    where: { userId, offerId, clickedAt: { gte: oneHourAgo } },
  })
  if (recentClicksSameOffer >= 3) flags.push('REPEATED_CLICK')

  return flags.length > 0
    ? { isSuspicious: true, flags }
    : { isSuspicious: false }
}

export async function recordRedirect(
  prisma: PrismaClient,
  shortCode: string,
  ip: string,
  userAgent: string,
): Promise<{ redirectUrl: string; opportunityId: string | null } | null> {
  const click = await prisma.affiliateClick.findUnique({
    where: { shortCode },
    include: { offer: true },
  })
  if (!click) return null

  const fraud = await checkForFraud(prisma, click.userId, click.offerId, ip)

  await prisma.affiliateClick.update({
    where: { id: click.id },
    data: {
      redirectedAt: new Date(),
      ...(fraud.isSuspicious
        ? { isSuspicious: true, fraudFlags: fraud.flags }
        : {}),
    },
  })

  if (click.opportunityId) {
    await prisma.opportunity.update({
      where: { id: click.opportunityId },
      data: { clickedAt: new Date(), status: 'CLICKED' },
    })
  }

  return { redirectUrl: click.redirectedToUrl, opportunityId: click.opportunityId }
}

export async function recordPostback(
  prisma: PrismaClient,
  clickRef: string,
  transactionId: string,
  commissionAmount: number,
  status: 'approved' | 'pending' | 'rejected',
  rawPayload: unknown,
): Promise<void> {
  const click = await prisma.affiliateClick.findUnique({ where: { clickRef } })
  if (!click) return

  const commissionStatus =
    status === 'approved' ? 'APPROVED' :
    status === 'rejected' ? 'REJECTED' : 'VALIDATED'

  await prisma.affiliateClick.update({
    where: { id: click.id },
    data: {
      transactionId,
      commissionStatus,
      commissionAmount,
      postbackReceivedAt: new Date(),
      postbackPayload: rawPayload as object,
    },
  })

  if (status === 'approved' && click.opportunityId) {
    await prisma.opportunity.update({
      where: { id: click.opportunityId },
      data: { convertedAt: new Date(), status: 'CONVERTED' },
    })
  }
}
