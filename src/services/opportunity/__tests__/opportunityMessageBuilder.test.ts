import { describe, it, expect } from 'vitest'
import {
  buildOutreachMessage,
  buildDetailMessage,
  CONSENT_PROMPT,
} from '../opportunityMessageBuilder.js'
import type { OpportunityContext } from '../opportunityMessageBuilder.js'

function makeCtx(overrides: Partial<OpportunityContext> = {}): OpportunityContext {
  return {
    categorySlug: 'savings',
    providerName: 'Marcus by Goldman Sachs',
    title: 'Easy Access Savings',
    shortDescription: '4.75% AER, no lock-in',
    keyBenefits: ['FSCS protected', 'No minimum lock-in'],
    parameters: { aer: 4.75, accessType: 'easy_access', minDeposit: 1, fscsProtected: true },
    annualSavingEstimate: 300,
    affiliateUrl: 'https://monika.app/r/test123',
    ...overrides,
  }
}

describe('buildOutreachMessage — savings', () => {
  it('includes provider name', () => {
    const { body } = buildOutreachMessage(makeCtx())
    expect(body).toContain('Marcus by Goldman Sachs')
  })

  it('includes annual saving estimate', () => {
    const { body } = buildOutreachMessage(makeCtx({ annualSavingEstimate: 142 }))
    expect(body).toContain('£142')
  })

  it('includes YES/NO/STOP reply options', () => {
    const { body } = buildOutreachMessage(makeCtx())
    expect(body).toContain('1')
    expect(body).toContain('2')
    expect(body).toContain('STOP')
  })

  it('includes FCA disclaimer', () => {
    const { body } = buildOutreachMessage(makeCtx())
    expect(body).toContain('not financial advice')
  })

  it('uses custom FCA disclaimer when provided', () => {
    const { body } = buildOutreachMessage(makeCtx({ fcaDisclaimer: 'Custom disclaimer here' }))
    expect(body).toContain('Custom disclaimer here')
  })

  it('returns correct category', () => {
    const { category } = buildOutreachMessage(makeCtx())
    expect(category).toBe('savings')
  })

  it('handles null annual saving estimate gracefully', () => {
    const { body } = buildOutreachMessage(makeCtx({ annualSavingEstimate: null }))
    expect(body).toBeTruthy()
    expect(body).toContain('Marcus by Goldman Sachs')
  })
})

describe('buildOutreachMessage — broadband', () => {
  const ctx = makeCtx({
    categorySlug: 'broadband',
    providerName: 'Vodafone',
    shortDescription: '100Mbps fibre',
    parameters: { speedMbps: 100, contractMonths: 24, monthlyPrice: 28, setupFee: 0 },
    currentMonthlySpend: 52,
    annualSavingEstimate: 288,
  })

  it('includes current spend', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('£52')
  })

  it('includes offer price', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('£28')
  })

  it('includes saving estimate', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('£288')
  })

  it('includes MORE option (reply 3)', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('3')
  })

  it('includes broadband disclaimer', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('termination charges')
  })
})

describe('buildOutreachMessage — mobile', () => {
  const ctx = makeCtx({
    categorySlug: 'mobile',
    providerName: 'iD Mobile',
    parameters: { dataGb: 'unlimited', monthlyPrice: 19, contractMonths: 24 },
    currentMonthlySpend: 45,
    annualSavingEstimate: 312,
  })

  it('includes unlimited data label', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('unlimited data')
  })

  it('includes remind-me option (reply 3)', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('contract')
  })
})

describe('buildOutreachMessage — business-banking', () => {
  const ctx = makeCtx({
    categorySlug: 'business-banking',
    providerName: 'Tide',
    parameters: { monthlyFee: 0, freeTransactionMonths: 99 },
    annualSavingEstimate: null,
  })

  it('mentions free plan', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('free')
  })

  it('includes business banking disclaimer', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('not financial advice')
  })
})

describe('buildOutreachMessage — accounting', () => {
  const ctx = makeCtx({
    categorySlug: 'accounting',
    providerName: 'FreeAgent',
    parameters: { monthlyPrice: 19, tier: 'Standard', trialDays: 30 },
    annualSavingEstimate: null,
  })

  it('includes trial period', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('30')
  })

  it('includes price', () => {
    const { body } = buildOutreachMessage(ctx)
    expect(body).toContain('£19')
  })
})

describe('buildDetailMessage — savings', () => {
  it('includes AER', () => {
    const detail = buildDetailMessage(makeCtx())
    expect(detail).toContain('4.75%')
  })

  it('includes affiliate link', () => {
    const detail = buildDetailMessage(makeCtx())
    expect(detail).toContain('monika.app/r/test123')
  })

  it('includes FSCS protection status', () => {
    const detail = buildDetailMessage(makeCtx())
    expect(detail).toContain('FSCS')
  })

  it('includes annual saving estimate', () => {
    const detail = buildDetailMessage(makeCtx({ annualSavingEstimate: 300 }))
    expect(detail).toContain('£300')
  })

  it('includes disclaimer', () => {
    const detail = buildDetailMessage(makeCtx())
    expect(detail).toContain('not financial advice')
  })
})

describe('buildDetailMessage — broadband', () => {
  it('includes speed and price', () => {
    const detail = buildDetailMessage(makeCtx({
      categorySlug: 'broadband',
      parameters: { speedMbps: 100, monthlyPrice: 28, setupFee: 0, contractMonths: 24 },
    }))
    expect(detail).toContain('100Mbps')
    expect(detail).toContain('£28')
  })
})

describe('CONSENT_PROMPT', () => {
  it('mentions max frequency', () => {
    expect(CONSENT_PROMPT).toContain('2 a week')
  })

  it('includes YES and NO options', () => {
    expect(CONSENT_PROMPT).toContain('YES')
    expect(CONSENT_PROMPT).toContain('NO')
  })

  it('includes STOP opt-out instructions', () => {
    expect(CONSENT_PROMPT).toContain('STOP')
  })

  it('includes not-financial-advice disclaimer', () => {
    expect(CONSENT_PROMPT).toContain('not financial advice')
  })
})
