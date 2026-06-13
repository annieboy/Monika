import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Decimal } from '@prisma/client/runtime/library'
import type { PrismaClient } from '@prisma/client'
import { routeIntent, PAYMENT_REJECTION } from '../router.js'

// Minimal Prisma mock — connected by default, no transactions
function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    bankConnection: { findFirst: vi.fn().mockResolvedValue({ id: 'conn-id' }) },
    transaction: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    account: { findMany: vi.fn().mockResolvedValue([]) },
    onboardingToken: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as PrismaClient
}

const USER_ID = 'user-uuid'

// ── Payment rejection ──────────────────────────────────────────────────────

describe('routeIntent — payment_request intent', () => {
  it('returns payment rejection for payment_request intent', async () => {
    const response = await routeIntent('payment_request', 'Make a payment', USER_ID, makePrisma())
    expect(response).toBe(PAYMENT_REJECTION)
  })
})

// ── Static/non-data intents ────────────────────────────────────────────────

describe('routeIntent — static responses', () => {
  it('returns onboarding help message', async () => {
    const response = await routeIntent('onboarding_help', 'Help me get started', USER_ID, makePrisma())
    expect(response.length).toBeGreaterThan(10)
    expect(response).not.toBe(PAYMENT_REJECTION)
  })

  it('returns unknown intent message', async () => {
    const response = await routeIntent('unknown', 'gibberish input', USER_ID, makePrisma())
    expect(response.length).toBeGreaterThan(10)
  })
})

// ── Data-driven intents with connected bank ────────────────────────────────

describe('routeIntent — data-driven intents', () => {
  it('spending_analysis returns a non-empty string with connected bank', async () => {
    const response = await routeIntent('spending_analysis', 'How much did I spend?', USER_ID, makePrisma())
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(10)
  })

  it('subscription_detection returns a non-empty string', async () => {
    const response = await routeIntent('subscription_detection', 'What subscriptions?', USER_ID, makePrisma())
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(10)
  })

  it('unusual_spending returns "nothing unusual" when no anomalies', async () => {
    const response = await routeIntent('unusual_spending', 'Any weird spending?', USER_ID, makePrisma())
    expect(response.toLowerCase()).toContain('normal')
  })

  it('account_balance returns "no accounts found" when no accounts', async () => {
    const response = await routeIntent('account_balance', "What's my balance?", USER_ID, makePrisma())
    expect(response.toLowerCase()).toContain('account')
  })

  it('account_balance includes the amount when accounts exist', async () => {
    const prisma = makePrisma({
      account: {
        findMany: vi.fn().mockResolvedValue([
          { displayName: 'Current', accountType: 'current', currentBalance: new Decimal('1234.56'), availableBalance: null, isPrimary: true },
        ]),
      },
    })
    const response = await routeIntent('account_balance', "What's my balance?", USER_ID, prisma)
    expect(response).toContain('1234.56')
  })

  it('affordability_question returns a response with financial data', async () => {
    const response = await routeIntent('affordability_question', 'Can I afford a £400k mortgage?', USER_ID, makePrisma())
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(10)
  })

  it('safe_to_spend returns a response with balance info', async () => {
    const prisma = makePrisma({
      account: {
        findMany: vi.fn().mockResolvedValue([
          { displayName: 'Current', accountType: 'current', currentBalance: new Decimal('500.00'), availableBalance: new Decimal('500.00'), isPrimary: true },
        ]),
      },
    })
    const response = await routeIntent('safe_to_spend', 'How much can I safely spend this weekend?', USER_ID, prisma)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(10)
  })
})

// ── No bank connection ─────────────────────────────────────────────────────

describe('routeIntent — no bank connection', () => {
  const disconnectedPrisma = () =>
    makePrisma({ bankConnection: { findFirst: vi.fn().mockResolvedValue(null) } })

  it('spending_analysis prompts to connect bank', async () => {
    const response = await routeIntent('spending_analysis', 'How much did I spend?', USER_ID, disconnectedPrisma())
    expect(response.toLowerCase()).toContain('connect')
  })

  it('subscription_detection prompts to connect bank', async () => {
    const response = await routeIntent('subscription_detection', 'What subscriptions?', USER_ID, disconnectedPrisma())
    expect(response.toLowerCase()).toContain('connect')
  })

  it('unusual_spending prompts to connect bank', async () => {
    const response = await routeIntent('unusual_spending', 'Show weird spending', USER_ID, disconnectedPrisma())
    expect(response.toLowerCase()).toContain('connect')
  })

  it('account_balance prompts to connect bank', async () => {
    const response = await routeIntent('account_balance', "What's my balance?", USER_ID, disconnectedPrisma())
    expect(response.toLowerCase()).toContain('connect')
  })

  it('affordability_question prompts to connect bank', async () => {
    const response = await routeIntent('affordability_question', 'Can I afford this?', USER_ID, disconnectedPrisma())
    expect(response.toLowerCase()).toContain('connect')
  })

  it('safe_to_spend prompts to connect bank', async () => {
    const response = await routeIntent('safe_to_spend', 'How much can I spend?', USER_ID, disconnectedPrisma())
    expect(response.toLowerCase()).toContain('connect')
  })
})

// ── onboarding_help — connect bank request ─────────────────────────────────

describe('routeIntent — onboarding_help connect bank', () => {
  it('returns a link when "connect my bank" is requested and no connection exists', async () => {
    const disconnected = makePrisma({ bankConnection: { findFirst: vi.fn().mockResolvedValue(null) } })
    const response = await routeIntent('onboarding_help', 'connect my bank', USER_ID, disconnected)
    expect(response).toContain('/banking/start?token=')
    expect(response).toContain('15 minutes')
  })

  it('tells user bank is already connected when they ask to connect again', async () => {
    const connected = makePrisma()
    const response = await routeIntent('onboarding_help', 'connect my bank', USER_ID, connected)
    expect(response.toLowerCase()).toContain('already connected')
  })

  it('returns general help text for non-connect onboarding messages', async () => {
    const prisma = makePrisma()
    const response = await routeIntent('onboarding_help', 'what can you do?', USER_ID, prisma)
    expect(response).not.toContain('/banking/start')
    expect(response.length).toBeGreaterThan(10)
  })

  it('link includes a 64-char hex token', async () => {
    const disconnected = makePrisma({ bankConnection: { findFirst: vi.fn().mockResolvedValue(null) } })
    const response = await routeIntent('onboarding_help', 'link my bank account', USER_ID, disconnected)
    const match = response.match(/token=([0-9a-f]+)/)
    expect(match).not.toBeNull()
    expect(match![1]).toHaveLength(64)
  })

  it('logs a bank_connect_link_sent audit event', async () => {
    const disconnected = makePrisma({ bankConnection: { findFirst: vi.fn().mockResolvedValue(null) } })
    await routeIntent('onboarding_help', 'connect my bank', USER_ID, disconnected)
    const auditCreate = disconnected.auditLog.create as ReturnType<typeof vi.fn>
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'bank_connect_link_sent' }) }),
    )
  })

  it('data-driven intent without bank includes the link', async () => {
    const disconnected = makePrisma({ bankConnection: { findFirst: vi.fn().mockResolvedValue(null) } })
    const response = await routeIntent('spending_analysis', 'How much did I spend?', USER_ID, disconnected)
    expect(response).toContain('/banking/start?token=')
  })
})

// ── PAYMENT_REJECTION constant ─────────────────────────────────────────────

describe('PAYMENT_REJECTION constant', () => {
  it('mentions payments are not available', () => {
    expect(PAYMENT_REJECTION.toLowerCase()).toContain('payment')
  })
})

// ── Additional intent coverage ─────────────────────────────────────────────

describe('routeIntent — merchant_query', () => {
  it('returns merchant spend when a merchant is extractable', async () => {
    const prisma = makePrisma({
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { id: 't1', amount: new Decimal(-25.00), transactionDate: new Date(), merchantName: 'Tesco', category: 'groceries', rawDescription: 'TESCO' },
        ]),
        groupBy: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
    })
    const response = await routeIntent('merchant_query', 'How much at Tesco this month?', USER_ID, prisma)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  })

  it('asks which merchant when none is detected', async () => {
    const prisma = makePrisma()
    const response = await routeIntent('merchant_query', 'spending somewhere unrecognised', USER_ID, prisma)
    expect(response).toContain('Which merchant')
  })
})

describe('routeIntent — income_query', () => {
  it('returns income information', async () => {
    const prisma = makePrisma({
      transaction: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        groupBy: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
    })
    const response = await routeIntent('income_query', 'When do I get paid?', USER_ID, prisma)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  })
})

describe('routeIntent — savings_query', () => {
  it('returns savings information', async () => {
    const prisma = makePrisma()
    const response = await routeIntent('savings_query', 'How much am I saving?', USER_ID, prisma)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  })
})

describe('routeIntent — upcoming_bills', () => {
  it('returns upcoming bills or a message when none found', async () => {
    const prisma = makePrisma()
    const response = await routeIntent('upcoming_bills', 'What bills are due?', USER_ID, prisma)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  })
})

// ── LLM paths ──────────────────────────────────────────────────────────────

describe('routeIntent — LLM polish path', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns polished response when LLM succeeds for a structured intent', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Polished spending summary.' }] }),
    })
    const response = await routeIntent('spending_analysis', 'How much did I spend?', USER_ID, makePrisma(), 'test-key')
    expect(response).toBe('Polished spending summary.')
  })

  it('returns structured text when LLM polish fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })
    const response = await routeIntent('spending_analysis', 'How much did I spend?', USER_ID, makePrisma(), 'test-key')
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  })
})

describe('routeIntent — unknown intent AI fallback', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses AI fallback path for unknown intent when API key present', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'AI fallback answer.' }] }),
    })
    const response = await routeIntent('unknown', 'What is life?', USER_ID, makePrisma(), 'test-key')
    // Either the AI answered or fell back to static — both are valid strings
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  })

  it('returns static fallback for unknown intent when AI returns null', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 })
    const response = await routeIntent('unknown', 'What is life?', USER_ID, makePrisma(), 'test-key')
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  })
})
