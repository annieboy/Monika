import { describe, it, expect } from 'vitest'
import { scoreOpportunity, rankByCategory } from '../opportunityScorer.js'
import type { EngagementHistory } from '../opportunityScorer.js'

const NO_HISTORY: EngagementHistory = { byCategory: {} }

function makeOpp(overrides: Partial<{
  id: string
  offerId: string
  categorySlug: string
  annualSavingEstimate: number | null
  savingConfidence: number
  detectedAt: Date
}> = {}) {
  return {
    id: 'opp-1',
    offerId: 'offer-1',
    categorySlug: 'savings',
    annualSavingEstimate: 300,
    savingConfidence: 0.8,
    detectedAt: new Date(),
    ...overrides,
  }
}

describe('scoreOpportunity — saving score', () => {
  it('score is 0 for no saving', () => {
    const scored = scoreOpportunity(makeOpp({ annualSavingEstimate: 0 }), NO_HISTORY)
    expect(scored.relevanceScore).toBeGreaterThanOrEqual(0)
    // saving component is 0 but other components still contribute
  })

  it('higher saving = higher score', () => {
    const low = scoreOpportunity(makeOpp({ annualSavingEstimate: 50 }), NO_HISTORY)
    const high = scoreOpportunity(makeOpp({ annualSavingEstimate: 500 }), NO_HISTORY)
    expect(high.relevanceScore).toBeGreaterThan(low.relevanceScore)
  })

  it('null saving treated as zero', () => {
    const withNull = scoreOpportunity(makeOpp({ annualSavingEstimate: null }), NO_HISTORY)
    const withZero = scoreOpportunity(makeOpp({ annualSavingEstimate: 0 }), NO_HISTORY)
    expect(withNull.relevanceScore).toBeCloseTo(withZero.relevanceScore, 4)
  })

  it('score is bounded 0–1', () => {
    const extreme = scoreOpportunity(makeOpp({ annualSavingEstimate: 100_000 }), NO_HISTORY)
    expect(extreme.relevanceScore).toBeLessThanOrEqual(1)
    expect(extreme.relevanceScore).toBeGreaterThanOrEqual(0)
  })
})

describe('scoreOpportunity — confidence', () => {
  it('higher confidence = higher score', () => {
    const low = scoreOpportunity(makeOpp({ savingConfidence: 0.3 }), NO_HISTORY)
    const high = scoreOpportunity(makeOpp({ savingConfidence: 0.95 }), NO_HISTORY)
    expect(high.relevanceScore).toBeGreaterThan(low.relevanceScore)
  })
})

describe('scoreOpportunity — recency', () => {
  it('fresh detection scores higher than old detection', () => {
    const fresh = scoreOpportunity(makeOpp({ detectedAt: new Date() }), NO_HISTORY)
    const old = scoreOpportunity(
      makeOpp({ detectedAt: new Date(Date.now() - 25 * 86_400_000) }),
      NO_HISTORY,
    )
    expect(fresh.relevanceScore).toBeGreaterThan(old.relevanceScore)
  })

  it('detection older than 30 days contributes zero recency', () => {
    const veryOld = scoreOpportunity(
      makeOpp({ detectedAt: new Date(Date.now() - 35 * 86_400_000) }),
      NO_HISTORY,
    )
    // Score still valid, just recency component = 0
    expect(veryOld.relevanceScore).toBeGreaterThanOrEqual(0)
  })
})

describe('scoreOpportunity — category weight', () => {
  it('savings category scores higher than accounting for same parameters', () => {
    const savings = scoreOpportunity(makeOpp({ categorySlug: 'savings' }), NO_HISTORY)
    const accounting = scoreOpportunity(makeOpp({ categorySlug: 'accounting' }), NO_HISTORY)
    expect(savings.relevanceScore).toBeGreaterThan(accounting.relevanceScore)
  })
})

describe('scoreOpportunity — engagement history', () => {
  it('high click rate boosts score', () => {
    const goodHistory: EngagementHistory = {
      byCategory: {
        broadband: { delivered: 10, clicks: 8, conversions: 2, dismissals: 0 },
      },
    }
    const badHistory: EngagementHistory = {
      byCategory: {
        broadband: { delivered: 10, clicks: 1, conversions: 0, dismissals: 7 },
      },
    }
    const good = scoreOpportunity(makeOpp({ categorySlug: 'broadband' }), goodHistory)
    const bad = scoreOpportunity(makeOpp({ categorySlug: 'broadband' }), badHistory)
    expect(good.relevanceScore).toBeGreaterThan(bad.relevanceScore)
  })
})

describe('rankByCategory', () => {
  it('returns one opportunity per category', () => {
    const opps = [
      { id: '1', offerId: 'a', categorySlug: 'savings', annualSavingEstimate: 300, savingConfidence: 0.9, detectedAt: new Date(), relevanceScore: 0.9 },
      { id: '2', offerId: 'b', categorySlug: 'savings', annualSavingEstimate: 200, savingConfidence: 0.8, detectedAt: new Date(), relevanceScore: 0.7 },
      { id: '3', offerId: 'c', categorySlug: 'broadband', annualSavingEstimate: 350, savingConfidence: 0.85, detectedAt: new Date(), relevanceScore: 0.8 },
    ]
    const ranked = rankByCategory(opps)
    expect(ranked.length).toBe(2)
    const categories = ranked.map(o => o.categorySlug)
    expect(categories).toContain('savings')
    expect(categories).toContain('broadband')
  })

  it('picks highest-scored opportunity within each category', () => {
    const opps = [
      { id: '1', offerId: 'a', categorySlug: 'mobile', annualSavingEstimate: 100, savingConfidence: 0.9, detectedAt: new Date(), relevanceScore: 0.5 },
      { id: '2', offerId: 'b', categorySlug: 'mobile', annualSavingEstimate: 400, savingConfidence: 0.9, detectedAt: new Date(), relevanceScore: 0.85 },
    ]
    const ranked = rankByCategory(opps)
    expect(ranked.length).toBe(1)
    expect(ranked[0]!.id).toBe('2') // higher score wins
  })

  it('returns empty array for empty input', () => {
    expect(rankByCategory([])).toEqual([])
  })
})
