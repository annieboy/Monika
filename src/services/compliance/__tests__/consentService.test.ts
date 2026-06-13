import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  isOptOutMessage,
  OPT_OUT_KEYWORDS,
  checkDeliveryEligibility,
  recordOptIn,
  recordOptOut,
} from '../consentService.js'

// ── isOptOutMessage ───────────────────────────────────────────────────────────

describe('isOptOutMessage', () => {
  it('detects STOP', () => {
    expect(isOptOutMessage('STOP')).toBe(true)
  })

  it('detects UNSUBSCRIBE', () => {
    expect(isOptOutMessage('UNSUBSCRIBE')).toBe(true)
  })

  it('detects NO MORE', () => {
    expect(isOptOutMessage('NO MORE')).toBe(true)
  })

  it('detects OPT OUT', () => {
    expect(isOptOutMessage('OPT OUT')).toBe(true)
  })

  it('detects REMOVE ME', () => {
    expect(isOptOutMessage('REMOVE ME')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isOptOutMessage('stop')).toBe(true)
    expect(isOptOutMessage('Stop')).toBe(true)
  })

  it('matches keyword at start of message with trailing text', () => {
    expect(isOptOutMessage('STOP please')).toBe(true)
  })

  it('does not false-positive on regular messages', () => {
    expect(isOptOutMessage('Hello Monika')).toBe(false)
    expect(isOptOutMessage('What is my balance?')).toBe(false)
    expect(isOptOutMessage('I want to stop spending so much')).toBe(false)
  })

  it('does not match STOP embedded in a word mid-sentence', () => {
    expect(isOptOutMessage('I want to stop spending')).toBe(false)
  })

  it('handles empty string without throwing', () => {
    expect(isOptOutMessage('')).toBe(false)
  })

  it('all OPT_OUT_KEYWORDS are detected', () => {
    for (const keyword of OPT_OUT_KEYWORDS) {
      expect(isOptOutMessage(keyword)).toBe(true)
    }
  })
})

// ── checkDeliveryEligibility helpers ─────────────────────────────────────────

// Pinned relative to the fake clock time used in beforeEach (2024-03-15T14:00:00Z)
const FAKE_NOW = new Date('2024-03-15T14:00:00Z')
const FUTURE = new Date(FAKE_NOW.getTime() + 7 * 86_400_000)
const PAST = new Date(FAKE_NOW.getTime() - 7 * 86_400_000)

interface PrefsShape {
  opportunitiesConsent: boolean
  consentWithdrawnAt: Date | null
  coolingOffUntil: Date | null
  maxMessagesPerWeek: number
  maxMessagesPerMonth: number
  quietHoursStart: string
  quietHoursEnd: string
  disabledCategories: string[]
}

const BASE_PREFS: PrefsShape = {
  opportunitiesConsent: true,
  consentWithdrawnAt: null,
  coolingOffUntil: null,
  maxMessagesPerWeek: 3,
  maxMessagesPerMonth: 10,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  disabledCategories: [],
}

function makePrisma(opts: {
  prefs?: Partial<PrefsShape> | null
  weeklyCount?: number
  monthlyCount?: number
}): PrismaClient {
  const prefs = opts.prefs === null ? null : { ...BASE_PREFS, ...opts.prefs }
  return {
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(prefs),
      upsert: vi.fn().mockResolvedValue(prefs ?? {}),
    },
    opportunity: {
      count: vi.fn()
        .mockResolvedValueOnce(opts.weeklyCount ?? 0)
        .mockResolvedValueOnce(opts.monthlyCount ?? 0),
    },
  } as unknown as PrismaClient
}

// ── checkDeliveryEligibility ──────────────────────────────────────────────────

describe('checkDeliveryEligibility', () => {
  beforeEach(() => {
    // Pin to 14:00 UTC — safely outside the default 21:00–08:00 quiet window
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15T14:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns eligible when all checks pass', async () => {
    const prisma = makePrisma({})
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result.eligible).toBe(true)
  })

  it('returns NO_CONSENT when prefs do not exist', async () => {
    const prisma = makePrisma({ prefs: null })
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result.eligible).toBe(false)
    expect(result).toMatchObject({ eligible: false, reason: 'NO_CONSENT' })
  })

  it('returns NO_CONSENT when opportunitiesConsent is false', async () => {
    const prisma = makePrisma({ prefs: { opportunitiesConsent: false } })
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result).toMatchObject({ eligible: false, reason: 'NO_CONSENT' })
  })

  it('returns CONSENT_WITHDRAWN when consentWithdrawnAt is set', async () => {
    const prisma = makePrisma({ prefs: { consentWithdrawnAt: PAST } })
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result).toMatchObject({ eligible: false, reason: 'CONSENT_WITHDRAWN' })
  })

  it('returns COOLING_OFF when coolingOffUntil is in the future', async () => {
    const prisma = makePrisma({ prefs: { coolingOffUntil: FUTURE } })
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result).toMatchObject({ eligible: false, reason: 'COOLING_OFF' })
  })

  it('does NOT block when coolingOffUntil is in the past', async () => {
    const prisma = makePrisma({ prefs: { coolingOffUntil: PAST } })
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result.eligible).toBe(true)
  })

  it('returns WEEKLY_CAP when weekly count equals the cap', async () => {
    const prisma = makePrisma({ weeklyCount: 3, monthlyCount: 3 })
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result).toMatchObject({ eligible: false, reason: 'WEEKLY_CAP' })
  })

  it('returns MONTHLY_CAP when monthly count equals the cap but weekly is under', async () => {
    const prisma = makePrisma({ weeklyCount: 1, monthlyCount: 10 })
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result).toMatchObject({ eligible: false, reason: 'MONTHLY_CAP' })
  })

  it('returns CATEGORY_DISABLED for a disabled category slug', async () => {
    const prisma = makePrisma({ prefs: { disabledCategories: ['insurance'] } })
    const result = await checkDeliveryEligibility(prisma, 'user-1', 'insurance')
    expect(result).toMatchObject({ eligible: false, reason: 'CATEGORY_DISABLED' })
  })

  it('returns eligible when category is not in disabled list', async () => {
    const prisma = makePrisma({ prefs: { disabledCategories: ['insurance'] } })
    const result = await checkDeliveryEligibility(prisma, 'user-1', 'energy')
    expect(result.eligible).toBe(true)
  })

  it('returns QUIET_HOURS when current time is in the overnight window', async () => {
    // Force a UTC time that falls in 21:00–08:00
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15T22:00:00Z')) // 22:00 UTC — in quiet hours

    const prisma = makePrisma({})
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result).toMatchObject({ eligible: false, reason: 'QUIET_HOURS' })
    vi.useRealTimers()
  })

  it('is eligible during daytime (outside quiet hours)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z')) // noon UTC

    const prisma = makePrisma({})
    const result = await checkDeliveryEligibility(prisma, 'user-1')
    expect(result.eligible).toBe(true)
    vi.useRealTimers()
  })
})

// ── recordOptIn ───────────────────────────────────────────────────────────────

describe('recordOptIn', () => {
  it('upserts consent with opportunitiesConsent=true', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({})
    const prisma = {
      userOpportunityPreferences: { upsert: mockUpsert },
    } as unknown as PrismaClient

    await recordOptIn(prisma, 'user-1', 'whatsapp_yes')

    expect(mockUpsert).toHaveBeenCalledOnce()
    const call = mockUpsert.mock.calls[0]![0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create.opportunitiesConsent).toBe(true)
    expect(call.create.consentMethod).toBe('whatsapp_yes')
    expect(call.update.opportunitiesConsent).toBe(true)
    // Re-opt-in must clear withdrawal and cooling-off
    expect(call.update.consentWithdrawnAt).toBeNull()
    expect(call.update.coolingOffUntil).toBeNull()
  })

  it('uses default method when not specified', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({})
    const prisma = {
      userOpportunityPreferences: { upsert: mockUpsert },
    } as unknown as PrismaClient

    await recordOptIn(prisma, 'user-1')
    const call = mockUpsert.mock.calls[0]![0] as { create: Record<string, unknown> }
    expect(call.create.consentMethod).toBe('whatsapp_opt_in')
  })
})

// ── recordOptOut ──────────────────────────────────────────────────────────────

describe('recordOptOut', () => {
  it('upserts with opportunitiesConsent=false and 30-day cooling-off', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({})
    const prisma = {
      userOpportunityPreferences: { upsert: mockUpsert },
    } as unknown as PrismaClient

    const before = Date.now()
    await recordOptOut(prisma, 'user-1')
    const after = Date.now()

    expect(mockUpsert).toHaveBeenCalledOnce()
    const call = mockUpsert.mock.calls[0]![0] as { create: Record<string, unknown>; update: Record<string, unknown> }

    expect(call.create.opportunitiesConsent).toBe(false)
    expect(call.update.opportunitiesConsent).toBe(false)

    // coolingOffUntil must be ~30 days from now
    const cooling = (call.update.coolingOffUntil as Date).getTime()
    const expectedMin = before + 29 * 86_400_000
    const expectedMax = after + 31 * 86_400_000
    expect(cooling).toBeGreaterThan(expectedMin)
    expect(cooling).toBeLessThan(expectedMax)

    expect(call.update.consentWithdrawnAt).toBeInstanceOf(Date)
  })
})
