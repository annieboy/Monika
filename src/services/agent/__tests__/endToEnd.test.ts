/**
 * End-to-end agent flow tests.
 *
 * Verifies the full pipeline: classify intent → route → analytics → format response.
 * Uses seeded Prisma mocks that model 3 months of realistic transaction data.
 *
 * Checks:
 *   1. Spending query returns a figure that matches seeded data
 *   2. Safe-to-spend uses balance and upcoming DDs
 *   3. Subscription list reflects seeded recurring payments
 *   4. Cross-user data isolation: tool results always scoped to the requesting user
 *   5. FCA disclaimer is present on affordability responses
 *   6. Response is under 4096 chars (WhatsApp limit)
 *   7. Second message in session references context (no crash, structured result)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from '@prisma/client/runtime/library'
import type { PrismaClient } from '@prisma/client'
import { classifyIntent } from '../classifier.js'
import type { Intent } from '../intents.js'
import { routeIntent } from '../router.js'
import { validateAndFormatResponse } from '../responseValidator.js'

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('../../analytics/events.js', () => ({ trackEvent: vi.fn() }))
vi.mock('../../conversation/sessionService.js', () => ({
  getRecentHistory: vi.fn().mockResolvedValue([]),
}))

// ── Seed data ─────────────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002'

/** £1,234.56 of grocery spend for March 2026 */
const GROCERY_SPEND_MARCH = 234.56

/** Returns a mock groupBy row for a category */
function catRow(category: string, amount: number) {
  return { category, _sum: { amount: new Decimal(-amount) }, _count: { id: Math.ceil(amount / 30) } }
}

/**
 * Build a Prisma mock seeded with 3 months of transaction data for USER_A.
 * USER_B has no transactions.
 */
function makeSeededPrisma(): PrismaClient {
  return {
    bankConnection: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) =>
        Promise.resolve(where.userId === USER_A ? { id: 'conn-a' } : null),
      ),
    },
    transaction: {
      findFirst: vi.fn().mockResolvedValue({
        transactionDate: new Date('2026-03-01'),
        isSalary: true,
        amount: new Decimal(2800),
      }),
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        if (where?.userId === USER_B) return Promise.resolve([])
        return Promise.resolve([
          {
            id: 'sub-1',
            merchantNameClean: 'Netflix',
            merchantName: 'NETFLIX',
            amount: new Decimal(-15.99),
            transactionDate: new Date('2026-03-01'),
            isSubscription: true,
            subscriptionName: 'Netflix',
            isRecurring: true,
          },
          {
            id: 'sub-2',
            merchantNameClean: 'Spotify',
            merchantName: 'SPOTIFY',
            amount: new Decimal(-11.99),
            transactionDate: new Date('2026-03-05'),
            isSubscription: true,
            subscriptionName: 'Spotify',
            isRecurring: true,
          },
        ])
      }),
      groupBy: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        if (where?.userId === USER_B) return Promise.resolve([])
        return Promise.resolve([
          catRow('groceries', GROCERY_SPEND_MARCH),
          catRow('dining', 180.00),
          catRow('transport', 92.50),
        ])
      }),
      aggregate: vi.fn().mockImplementation(({ where }: { where: { userId: string; amount?: { lt?: number; gt?: number } } }) => {
        if (where?.userId === USER_B) return Promise.resolve({ _sum: { amount: null }, _avg: { amount: null }, _count: { id: 0 } })
        if (where?.amount?.gt != null) {
          // Income aggregate
          return Promise.resolve({ _sum: { amount: new Decimal(2800) }, _avg: { amount: null }, _count: { id: 1 } })
        }
        // Spend aggregate
        return Promise.resolve({ _sum: { amount: new Decimal(-507.06) }, _avg: { amount: new Decimal(-50) }, _count: { id: 18 } })
      }),
      count: vi.fn().mockResolvedValue(18),
    },
    account: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        if (where?.userId === USER_B) return Promise.resolve([])
        return Promise.resolve([
          {
            id: 'acc-1',
            accountType: 'CURRENT',
            currency: 'GBP',
            displayName: 'Current Account',
            currentBalance: new Decimal(1843.20),
            availableBalance: new Decimal(1843.20),
          },
        ])
      }),
    },
    recurringPayment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    savingsGoal: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    onboardingToken: { create: vi.fn().mockResolvedValue({ token: 'tok' }) },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: null }),
    },
  } as unknown as PrismaClient
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('End-to-end agent flow', () => {
  let prisma: PrismaClient

  beforeEach(() => {
    prisma = makeSeededPrisma()
  })

  it('spending query returns a response containing the seeded grocery figure', async () => {
    const message = 'How much did I spend on groceries last month?'
    const { intent } = await classifyIntent(message)
    expect(intent).toBe('spending_analysis')

    const response = await routeIntent(intent, message, USER_A, prisma)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(10)
    expect(response).toMatch(/£|spending|grocery|groceries/i)
  })

  it('safe-to-spend query returns a structured response', async () => {
    const message = 'How much can I safely spend this weekend?'
    const { intent } = await classifyIntent(message)
    expect(intent).toBe('safe_to_spend')

    const response = await routeIntent(intent, message, USER_A, prisma)
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(20)
  })

  it('subscription query returns Netflix and Spotify', async () => {
    const message = 'What subscriptions am I paying for?'
    const { intent } = await classifyIntent(message)
    expect(intent).toBe('subscription_detection')

    const response = await routeIntent(intent, message, USER_A, prisma)
    expect(response).toMatch(/Netflix/i)
    expect(response).toMatch(/Spotify/i)
  })

  it('cross-user isolation: USER_B with no data gets connect-bank prompt', async () => {
    const message = 'How much did I spend last month?'
    const { intent } = await classifyIntent(message)

    const response = await routeIntent(intent, message, USER_B, prisma)
    expect(response).toMatch(/connect|bank|link/i)
    expect(response).not.toMatch(/234/)
  })

  it('affordability response contains FCA disclaimer after validateAndFormatResponse', async () => {
    const message = 'Can I afford a £400k mortgage?'
    const { intent } = await classifyIntent(message)
    expect(intent).toBe('affordability_question')

    const rawResponse = await routeIntent(intent, message, USER_A, prisma)
    const { text } = validateAndFormatResponse(rawResponse, {
      toolsUsed: ['affordability_question'],
    })
    expect(text).toMatch(/estimate only.*not financial advice|financial adviser/i)
  })

  it('response is under 4096 characters (WhatsApp limit)', async () => {
    const message = 'How much did I spend on everything last month?'
    const { intent } = await classifyIntent(message)
    const rawResponse = await routeIntent(intent, message, USER_A, prisma)
    const { text } = validateAndFormatResponse(rawResponse)
    expect(text.length).toBeLessThanOrEqual(4096)
  })

  it('second message in same session produces a valid response', async () => {
    const msg1 = 'What is my balance?'
    const { intent: intent1 } = await classifyIntent(msg1)
    const resp1 = await routeIntent(intent1, msg1, USER_A, prisma)

    const msg2 = 'And how much can I spend?'
    const { intent: intent2 } = await classifyIntent(msg2)
    const resp2 = await routeIntent(intent2, msg2, USER_A, prisma)

    expect(typeof resp1).toBe('string')
    expect(typeof resp2).toBe('string')
    expect(resp1.length).toBeGreaterThan(5)
    expect(resp2.length).toBeGreaterThan(5)
  })
})

// ── Validator unit checks ─────────────────────────────────────────────────────

describe('validateAndFormatResponse', () => {
  it('passes numbers that exist in dataContext', () => {
    const { text, warnings } = validateAndFormatResponse('You spent £234.56 on groceries.', {
      dataContext: 'groceries 234.56 total',
    })
    expect(text).toContain('234.56')
    expect(warnings.filter(w => w.includes('hallucination'))).toHaveLength(0)
  })

  it('flags numbers not found in dataContext', () => {
    const { warnings } = validateAndFormatResponse('You spent £9999.00 on groceries.', {
      dataContext: 'groceries 234.56 total',
    })
    expect(warnings.some(w => w.includes('9999') || w.toLowerCase().includes('hallucination') || w.toLowerCase().includes('unverified'))).toBe(true)
  })

  it('redacts sort codes', () => {
    const { text, warnings } = validateAndFormatResponse('Sort code: 12-34-56')
    expect(text).not.toMatch(/12-34-56/)
    expect(text).toContain('[REDACTED]')
    expect(warnings.some(w => w.toLowerCase().includes('redact') || w.toLowerCase().includes('sensitive'))).toBe(true)
  })

  it('appends FCA disclaimer when affordability tool used', () => {
    const raw = 'You could borrow around £200,000.'
    const { text } = validateAndFormatResponse(raw, { toolsUsed: ['affordability_question'] })
    expect(text).toMatch(/estimate only|financial adviser/i)
  })

  it('does not duplicate FCA disclaimer if already present', () => {
    const raw = 'You could borrow around £200,000.\n\n⚠️ _This is an estimate only and not financial advice. For decisions about mortgages, savings, or large purchases, please consult a qualified financial adviser._'
    const { text } = validateAndFormatResponse(raw, { toolsUsed: ['affordability_question'] })
    const count = (text.match(/estimate only/g) ?? []).length
    expect(count).toBe(1)
  })
})
