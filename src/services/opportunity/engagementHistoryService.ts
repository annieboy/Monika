/**
 * Loads real engagement history from the DB for the opportunity scorer.
 *
 * The scorer uses click/conversion/dismissal rates per category to weight
 * opportunities. This service computes those rates from the Opportunity table.
 *
 * Per-user rates are used when the user has enough history (≥3 delivered).
 * Global rates are used as a fallback for new users.
 */
import type { PrismaClient } from '@prisma/client'
import type { EngagementHistory } from './opportunityScorer.js'

interface RawEngagement {
  categorySlug: string
  delivered: number
  clicks: number
  conversions: number
  dismissals: number
}

async function loadEngagementRows(
  prisma: PrismaClient,
  userId: string,
): Promise<RawEngagement[]> {
  // Raw SQL for efficiency — one query instead of N+1
  return prisma.$queryRaw<RawEngagement[]>`
    SELECT
      oc.slug                                                         AS "categorySlug",
      COUNT(*)::int                                                   AS "delivered",
      COUNT(*) FILTER (WHERE o.status = 'CLICKED')::int              AS "clicks",
      COUNT(*) FILTER (WHERE o.status = 'CONVERTED')::int            AS "conversions",
      COUNT(*) FILTER (WHERE o.status = 'DISMISSED')::int            AS "dismissals"
    FROM opportunities o
    JOIN offers       of ON of.id = o.offer_id
    JOIN offer_categories oc ON oc.id = of.category_id
    WHERE o.user_id = ${userId}::uuid
      AND o.status IN ('DELIVERED', 'CLICKED', 'CONVERTED', 'DISMISSED', 'EXPIRED')
    GROUP BY oc.slug
  `
}

async function loadGlobalEngagementRows(prisma: PrismaClient): Promise<RawEngagement[]> {
  return prisma.$queryRaw<RawEngagement[]>`
    SELECT
      oc.slug                                                         AS "categorySlug",
      COUNT(*)::int                                                   AS "delivered",
      COUNT(*) FILTER (WHERE o.status = 'CLICKED')::int              AS "clicks",
      COUNT(*) FILTER (WHERE o.status = 'CONVERTED')::int            AS "conversions",
      COUNT(*) FILTER (WHERE o.status = 'DISMISSED')::int            AS "dismissals"
    FROM opportunities o
    JOIN offers       of ON of.id = o.offer_id
    JOIN offer_categories oc ON oc.id = of.category_id
    WHERE o.status IN ('DELIVERED', 'CLICKED', 'CONVERTED', 'DISMISSED', 'EXPIRED')
    GROUP BY oc.slug
  `
}

const MIN_HISTORY_COUNT = 3  // need at least this many delivered to use personal rates

export async function loadEngagementHistory(
  prisma: PrismaClient,
  userId: string,
): Promise<EngagementHistory> {
  const [userRows, globalRows] = await Promise.all([
    loadEngagementRows(prisma, userId),
    loadGlobalEngagementRows(prisma),
  ])

  const globalByCategory: Record<string, RawEngagement> = {}
  for (const row of globalRows) {
    globalByCategory[row.categorySlug] = row
  }

  const byCategory: EngagementHistory['byCategory'] = {}

  // Use personal rates where available, fall back to global
  const allCategories = new Set([
    ...userRows.map(r => r.categorySlug),
    ...globalRows.map(r => r.categorySlug),
  ])

  for (const slug of allCategories) {
    const userRow = userRows.find(r => r.categorySlug === slug)
    const globalRow = globalByCategory[slug]

    if (userRow && userRow.delivered >= MIN_HISTORY_COUNT) {
      byCategory[slug] = {
        delivered:   userRow.delivered,
        clicks:      userRow.clicks,
        conversions: userRow.conversions,
        dismissals:  userRow.dismissals,
      }
    } else if (globalRow && globalRow.delivered > 0) {
      byCategory[slug] = {
        delivered:   globalRow.delivered,
        clicks:      globalRow.clicks,
        conversions: globalRow.conversions,
        dismissals:  globalRow.dismissals,
      }
    }
  }

  return { byCategory }
}
