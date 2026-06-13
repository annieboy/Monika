/**
 * Scores and ranks opportunities per user using a weighted composite formula:
 *
 *   relevanceScore =
 *     savingScore         × 0.40   (log scale: £50→0.3, £200→0.6, £500→0.85, £1k+→1.0)
 *     confidenceScore     × 0.25   (cadence/detection confidence 0–1)
 *     engagementScore     × 0.15   (user's historical click/conversion rate per category)
 *     categoryWeight      × 0.10   (savings=0.9, broadband=0.8, mobile=0.7 …)
 *     recencyScore        × 0.10   (decays linearly to 0 over 30 days)
 */

export interface EngagementHistory {
  byCategory: Record<string, CategoryEngagement>
}

export interface CategoryEngagement {
  delivered: number
  clicks: number
  conversions: number
  dismissals: number
}

export interface ScoredOpportunity {
  id: string
  offerId: string
  categorySlug: string
  annualSavingEstimate: number
  savingConfidence: number
  detectedAt: Date
  relevanceScore: number
}

const CATEGORY_WEIGHTS: Record<string, number> = {
  savings:          0.9,
  broadband:        0.8,
  mobile:           0.7,
  'business-banking': 0.6,
  accounting:       0.6,
}

function scoreSaving(annualEstimate: number): number {
  if (annualEstimate <= 0) return 0
  // log10 scale: £10→0.33, £50→0.57, £200→0.77, £500→0.90, £1000→1.0
  return Math.min(1, Math.log10(Math.max(1, annualEstimate)) / 3)
}

function scoreEngagement(categorySlug: string, history: EngagementHistory): number {
  const cat = history.byCategory[categorySlug]
  if (!cat || cat.delivered === 0) return 0.5 // neutral prior

  const clickRate = cat.clicks / cat.delivered
  const convRate = cat.conversions / Math.max(cat.clicks, 1)
  const dismissRate = cat.dismissals / cat.delivered

  return Math.max(0, Math.min(1, clickRate * 0.6 + convRate * 0.4 - dismissRate * 0.3))
}

function scoreRecency(detectedAt: Date): number {
  const ageMs = Date.now() - detectedAt.getTime()
  const ageDays = ageMs / 86_400_000
  // Linear decay from 1.0 (fresh) to 0.0 at 30 days
  return Math.max(0, 1 - ageDays / 30)
}

export function scoreOpportunity(
  opp: {
    id: string
    offerId: string
    categorySlug: string
    annualSavingEstimate: number | null
    savingConfidence: number
    detectedAt: Date
  },
  history: EngagementHistory,
): ScoredOpportunity {
  const saving = Number(opp.annualSavingEstimate ?? 0)
  const categoryWeight = CATEGORY_WEIGHTS[opp.categorySlug] ?? 0.5

  const relevanceScore =
    scoreSaving(saving)                            * 0.40 +
    opp.savingConfidence                           * 0.25 +
    scoreEngagement(opp.categorySlug, history)     * 0.15 +
    categoryWeight                                 * 0.10 +
    scoreRecency(opp.detectedAt)                   * 0.10

  return {
    id: opp.id,
    offerId: opp.offerId,
    categorySlug: opp.categorySlug,
    annualSavingEstimate: saving,
    savingConfidence: opp.savingConfidence,
    detectedAt: opp.detectedAt,
    relevanceScore: Math.round(relevanceScore * 10000) / 10000,
  }
}

/**
 * From a list of opportunities, pick the top-scored one per category.
 * Guarantees no category is over-represented in a single delivery batch.
 */
export function rankByCategory(
  opportunities: ScoredOpportunity[],
): ScoredOpportunity[] {
  const sorted = [...opportunities].sort((a, b) => b.relevanceScore - a.relevanceScore)
  const seen = new Set<string>()
  const top: ScoredOpportunity[] = []

  for (const opp of sorted) {
    if (!seen.has(opp.categorySlug)) {
      seen.add(opp.categorySlug)
      top.push(opp)
    }
  }

  return top
}
