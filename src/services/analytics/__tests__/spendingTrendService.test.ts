import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('+447911123456')),
}))

vi.mock('../../../config.js', () => ({
  config: {
    ENCRYPTION_KEY: 'key',
    WHATSAPP_PHONE_NUMBER_ID: 'pid',
    WHATSAPP_ACCESS_TOKEN: 'tok',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
  },
}))

vi.mock('../../../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getSpendingTrends, formatSpendingTrends, runSpendingTrendAlertBatch } from '../spendingTrendService.js'
import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

// This month + last 3 months spending rows
function makeGroupByRow(category: string, amount: number) {
  return { category, _sum: { amount: -amount } }  // negative = spend
}

function makePrisma(opts: {
  thisMonth?: Array<{ category: string; amount: number }>
  last3months?: Array<{ category: string; amount: number }>
  hasRemindedRecently?: boolean
  hasPhone?: boolean
  activeUsers?: string[]
} = {}) {
  const thisMonthRows = (opts.thisMonth ?? []).map(r => makeGroupByRow(r.category, r.amount))
  const last3MonthsRows = (opts.last3months ?? []).map(r => makeGroupByRow(r.category, r.amount))

  let callCount = 0

  return {
    transaction: {
      groupBy: vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve(callCount === 1 ? thisMonthRows : last3MonthsRows)
      }),
    },
    bankConnection: {
      findMany: vi.fn().mockResolvedValue(
        (opts.activeUsers ?? ['user-1']).map(id => ({ userId: id })),
      ),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(opts.hasRemindedRecently ? { id: 'log-1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(
        opts.hasPhone !== false ? { whatsappPhoneEnc: 'enc' } : { whatsappPhoneEnc: null },
      ),
    },
  } as unknown as PrismaClient
}

// ── getSpendingTrends ─────────────────────────────────────────────────────────

describe('getSpendingTrends', () => {
  it('flags category as rising when >20% above 3-month average', async () => {
    const prisma = makePrisma({
      thisMonth: [{ category: 'eating out', amount: 200 }],
      last3months: [{ category: 'eating out', amount: 150 * 3 }], // avg = 150
    })
    const result = await getSpendingTrends(prisma, 'user-1')
    expect(result.rising).toHaveLength(1)
    expect(result.rising[0]!.category).toBe('eating out')
    expect(result.rising[0]!.changePct).toBeGreaterThan(0.2)
  })

  it('flags category as falling when >20% below 3-month average', async () => {
    const prisma = makePrisma({
      thisMonth: [{ category: 'groceries', amount: 80 }],
      last3months: [{ category: 'groceries', amount: 120 * 3 }], // avg = 120
    })
    const result = await getSpendingTrends(prisma, 'user-1')
    expect(result.falling).toHaveLength(1)
    expect(result.falling[0]!.direction).toBe('falling')
  })

  it('ignores categories below £10 threshold', async () => {
    const prisma = makePrisma({
      thisMonth: [{ category: 'misc', amount: 5 }],
      last3months: [{ category: 'misc', amount: 3 * 3 }],
    })
    const result = await getSpendingTrends(prisma, 'user-1')
    expect(result.trends).toHaveLength(0)
  })

  it('returns stable when change is within ±20%', async () => {
    const prisma = makePrisma({
      thisMonth: [{ category: 'transport', amount: 110 }],
      last3months: [{ category: 'transport', amount: 100 * 3 }],
    })
    const result = await getSpendingTrends(prisma, 'user-1')
    expect(result.trends[0]!.direction).toBe('stable')
    expect(result.rising).toHaveLength(0)
    expect(result.falling).toHaveLength(0)
  })

  it('returns empty trends when no history exists', async () => {
    const prisma = makePrisma({ thisMonth: [], last3months: [] })
    const result = await getSpendingTrends(prisma, 'user-1')
    expect(result.trends).toHaveLength(0)
  })
})

// ── formatSpendingTrends ──────────────────────────────────────────────────────

describe('formatSpendingTrends', () => {
  it('shows rising categories with percentage', () => {
    const out = formatSpendingTrends({
      trends: [{ category: 'eating out', thisMonth: 200, avgLast3Months: 150, changePct: 0.33, direction: 'rising' }],
      rising: [{ category: 'eating out', thisMonth: 200, avgLast3Months: 150, changePct: 0.33, direction: 'rising' }],
      falling: [],
    })
    expect(out).toMatch(/eating out/i)
    expect(out).toMatch(/33%/)
    expect(out).toMatch(/£200/)
  })

  it('shows no-data message when trends are empty', () => {
    const out = formatSpendingTrends({ trends: [], rising: [], falling: [] })
    expect(out).toMatch(/don't have enough data/i)
  })
})

// ── runSpendingTrendAlertBatch ────────────────────────────────────────────────

describe('runSpendingTrendAlertBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends WhatsApp message when rising category found', async () => {
    const prisma = makePrisma({
      thisMonth: [{ category: 'eating out', amount: 200 }],
      last3months: [{ category: 'eating out', amount: 150 * 3 }],
    })
    const result = await runSpendingTrendAlertBatch(prisma)
    expect(result.notified).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'spending_trend_alert_sent' }),
      }),
    )
  })

  it('skips when recently alerted', async () => {
    const prisma = makePrisma({
      thisMonth: [{ category: 'eating out', amount: 200 }],
      last3months: [{ category: 'eating out', amount: 150 * 3 }],
      hasRemindedRecently: true,
    })
    const result = await runSpendingTrendAlertBatch(prisma)
    expect(result.notified).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when no rising categories', async () => {
    const prisma = makePrisma({ thisMonth: [], last3months: [] })
    const result = await runSpendingTrendAlertBatch(prisma)
    expect(result.notified).toBe(0)
  })

  it('skips when user has no phone', async () => {
    const prisma = makePrisma({
      thisMonth: [{ category: 'eating out', amount: 200 }],
      last3months: [{ category: 'eating out', amount: 150 * 3 }],
      hasPhone: false,
    })
    const result = await runSpendingTrendAlertBatch(prisma)
    expect(result.notified).toBe(0)
  })
})
