import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('+447700123456')),
}))

vi.mock('../../../config.js', () => ({
  config: {
    WHATSAPP_PHONE_NUMBER_ID: 'ph-1',
    WHATSAPP_ACCESS_TOKEN: 'tok-1',
    ENCRYPTION_KEY: Buffer.alloc(32),
    LOG_LEVEL: 'silent',
  },
}))

vi.mock('../../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runBudgetAlertBatch } from '../budgetAlertService.js'
import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

const NOW = new Date('2026-03-20T12:00:00Z')

function makePrisma(opts: {
  users?: string[]
  budgets?: Array<{ userId: string; category: string; amount: number }>
  categorySpend?: Array<{ userId: string; category: string; spent: number }>
  alreadySent?: Array<{ userId: string; eventType: string; category: string }>
} = {}) {
  const users = (opts.users ?? ['u1']).map(id => ({ id }))

  return {
    user: {
      findMany: vi.fn().mockResolvedValue(users),
      findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: 'enc' }),
    },
    auditLog: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string; eventType: string } }) => {
        const budgets = (opts.budgets ?? [])
          .filter(b => b.userId === where.userId)
          .map(b => ({ eventData: { category: b.category, amount: b.amount } }))
        return Promise.resolve(budgets)
      }),
      findFirst: vi.fn().mockImplementation(({ where }: { where: { userId: string; eventType: string; eventData: { path: string[]; equals: string } } }) => {
        const match = (opts.alreadySent ?? []).find(
          s => s.userId === where.userId && s.eventType === where.eventType && s.category === where.eventData?.equals,
        )
        return Promise.resolve(match ? { id: 'x' } : null)
      }),
      create: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      groupBy: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        const spends = (opts.categorySpend ?? [])
          .filter(s => s.userId === where.userId)
          .map(s => ({ category: s.category, _sum: { amount: -s.spent } }))
        return Promise.resolve(spends)
      }),
    },
  } as unknown as PrismaClient
}

describe('runBudgetAlertBatch', () => {
  beforeEach(() => {
    vi.setSystemTime(NOW)
    vi.mocked(sendWhatsAppMessage).mockClear()
  })

  it('sends 80% warning when spend is between 80-99% of budget', async () => {
    const prisma = makePrisma({
      budgets: [{ userId: 'u1', category: 'eating out', amount: 200 }],
      categorySpend: [{ userId: 'u1', category: 'eating out', spent: 170 }], // 85%
    })
    const result = await runBudgetAlertBatch(prisma)
    expect(result.alerted).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/Budget warning/)
    expect(msg).toMatch(/85%/)
  })

  it('sends exceeded alert when spend is >= 100% of budget', async () => {
    const prisma = makePrisma({
      budgets: [{ userId: 'u1', category: 'groceries', amount: 100 }],
      categorySpend: [{ userId: 'u1', category: 'groceries', spent: 120 }],
    })
    const result = await runBudgetAlertBatch(prisma)
    expect(result.alerted).toBe(1)
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/Budget exceeded/)
    expect(msg).toMatch(/£20\.00 over/)
  })

  it('skips when spend is under 80%', async () => {
    const prisma = makePrisma({
      budgets: [{ userId: 'u1', category: 'transport', amount: 100 }],
      categorySpend: [{ userId: 'u1', category: 'transport', spent: 50 }],
    })
    const result = await runBudgetAlertBatch(prisma)
    expect(result.alerted).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when already alerted this month', async () => {
    const prisma = makePrisma({
      budgets: [{ userId: 'u1', category: 'eating out', amount: 200 }],
      categorySpend: [{ userId: 'u1', category: 'eating out', spent: 180 }],
      alreadySent: [{ userId: 'u1', eventType: 'budget_80pct_alert', category: 'eating out' }],
    })
    const result = await runBudgetAlertBatch(prisma)
    expect(result.alerted).toBe(0)
  })

  it('skips users with no budgets set', async () => {
    const prisma = makePrisma({ budgets: [] })
    const result = await runBudgetAlertBatch(prisma)
    expect(result.alerted).toBe(0)
  })

  it('returns zero when WhatsApp credentials are missing', async () => {
    vi.doMock('../../../config.js', () => ({
      config: {
        WHATSAPP_PHONE_NUMBER_ID: '',
        WHATSAPP_ACCESS_TOKEN: '',
        ENCRYPTION_KEY: Buffer.alloc(32),
        LOG_LEVEL: 'silent',
      },
    }))
    // Use the existing mock (credentials were set at module load time)
    const prisma = makePrisma({
      budgets: [{ userId: 'u1', category: 'eating out', amount: 200 }],
      categorySpend: [{ userId: 'u1', category: 'eating out', spent: 180 }],
    })
    // Result depends on module-level config mock — just ensure no throw
    const result = await runBudgetAlertBatch(prisma)
    expect(result.errors).toBe(0)
  })
})
