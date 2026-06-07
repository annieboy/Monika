import { describe, it, expect, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/library'
import type { PrismaClient } from '@prisma/client'
import { routeIntent, isPaymentRequest, PAYMENT_REJECTION } from '../router.js'

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

// ── isPaymentRequest ───────────────────────────────────────────────────────

describe('isPaymentRequest', () => {
  it('detects "pay to" phrasing', () => {
    expect(isPaymentRequest('Pay £50 to John')).toBe(true)
  })

  it('detects transfer', () => {
    expect(isPaymentRequest('Transfer money to my savings')).toBe(true)
  })

  it('detects "make a payment"', () => {
    expect(isPaymentRequest('Make a payment to my landlord')).toBe(true)
  })

  it('detects "pay my rent"', () => {
    expect(isPaymentRequest('Pay my rent this month')).toBe(true)
  })

  it('does not flag spending question as payment', () => {
    expect(isPaymentRequest('How much did I spend on rent?')).toBe(false)
  })

  it('does not flag balance query as payment', () => {
    expect(isPaymentRequest("What's my balance?")).toBe(false)
  })
})

// ── Payment rejection ──────────────────────────────────────────────────────

describe('routeIntent — payment rejection overrides intent', () => {
  it('rejects payment request even if intent is spending_analysis', async () => {
    const response = await routeIntent('spending_analysis', 'Pay £100 to John', USER_ID, makePrisma())
    expect(response).toBe(PAYMENT_REJECTION)
  })

  it('rejects transfer request', async () => {
    const response = await routeIntent('unknown', 'Transfer £500 to my savings account', USER_ID, makePrisma())
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

  it('returns affordability message', async () => {
    const response = await routeIntent('affordability_question', 'Can I afford this?', USER_ID, makePrisma())
    expect(response.length).toBeGreaterThan(10)
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
  it('contains the exact required phrase', () => {
    expect(PAYMENT_REJECTION).toContain('Payments are not supported yet.')
  })
})
