import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { runDebtMilestoneBatch } from '../debtMilestoneService.js'

vi.mock('../../whatsapp/sender.js', () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wam-1' }) }))
vi.mock('../../../lib/crypto.js', () => ({ decrypt: vi.fn(() => Buffer.from('+447700900000')) }))
vi.mock('../../../config.js', () => ({
  config: { ENCRYPTION_KEY: 'a'.repeat(64), WHATSAPP_PHONE_NUMBER_ID: 'ph-1', WHATSAPP_ACCESS_TOKEN: 'tok-1' },
}))
vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

function makePrisma(opts: {
  goals?: Array<{ id: string; name: string; targetAmount: Decimal; currentAmount: Decimal }>
  alreadyNotified?: boolean
} = {}): PrismaClient {
  return {
    bankConnection: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) },
    savingsGoal: { findMany: vi.fn().mockResolvedValue(opts.goals ?? []) },
    user: { findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: 'enc' }) },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(opts.alreadyNotified ? { id: 'log-1', eventData: { milestone: 50 } } : null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runDebtMilestoneBatch', () => {
  beforeEach(() => { vi.mocked(sendWhatsAppMessage).mockClear() })

  it('sends 50% milestone notification', async () => {
    const prisma = makePrisma({
      goals: [{ id: 'goal-1', name: 'Pay off Car Loan', targetAmount: new Decimal(5000), currentAmount: new Decimal(2500) }],
    })
    const result = await runDebtMilestoneBatch(prisma)
    expect(result.notified).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/Car Loan/)
    expect(msg).toMatch(/50%/)
  })

  it('sends 100% paid-off celebration', async () => {
    const prisma = makePrisma({
      goals: [{ id: 'goal-1', name: 'Pay off Credit Card', targetAmount: new Decimal(2000), currentAmount: new Decimal(2000) }],
    })
    const result = await runDebtMilestoneBatch(prisma)
    expect(result.notified).toBe(1)
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/fully paid off/i)
  })

  it('skips when already notified for this milestone', async () => {
    const prisma = makePrisma({
      goals: [{ id: 'goal-1', name: 'Pay off Car Loan', targetAmount: new Decimal(5000), currentAmount: new Decimal(2500) }],
      alreadyNotified: true,
    })
    const result = await runDebtMilestoneBatch(prisma)
    expect(result.notified).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns zero when no debt goals', async () => {
    const prisma = makePrisma({ goals: [] })
    const result = await runDebtMilestoneBatch(prisma)
    expect(result.notified).toBe(0)
    expect(result.processed).toBe(1)
  })
})
