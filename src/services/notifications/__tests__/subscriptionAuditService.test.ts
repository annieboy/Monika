import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { runSubscriptionAuditBatch } from '../subscriptionAuditService.js'

vi.mock('../../whatsapp/sender.js', () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wam-1' }) }))
vi.mock('../../../lib/crypto.js', () => ({ decrypt: vi.fn(() => Buffer.from('+447700900000')) }))
vi.mock('../../../config.js', () => ({
  config: { ENCRYPTION_KEY: 'a'.repeat(64), WHATSAPP_PHONE_NUMBER_ID: 'ph-1', WHATSAPP_ACCESS_TOKEN: 'tok-1' },
}))
vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

function makePrisma(opts: {
  recurring?: Array<{ merchantName: string; merchantCategory: string; typicalAmount: Decimal; frequency: string }>
  alreadyAudited?: boolean
} = {}): PrismaClient {
  const defaultRecurring = [
    { merchantName: 'Netflix', merchantCategory: 'streaming', typicalAmount: new Decimal(15.99), frequency: 'monthly' },
    { merchantName: 'Spotify', merchantCategory: 'entertainment', typicalAmount: new Decimal(9.99), frequency: 'monthly' },
  ]
  return {
    bankConnection: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) },
    recurringPayment: { findMany: vi.fn().mockResolvedValue(opts.recurring ?? defaultRecurring) },
    user: { findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: 'enc' }) },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(opts.alreadyAudited ? { id: 'log-1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runSubscriptionAuditBatch', () => {
  beforeEach(() => { vi.mocked(sendWhatsAppMessage).mockClear() })

  it('sends subscription digest for active subscriptions', async () => {
    const prisma = makePrisma()
    const result = await runSubscriptionAuditBatch(prisma)
    expect(result.sent).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/Netflix/)
    expect(msg).toMatch(/Spotify/)
    expect(msg).toMatch(/subscription audit/i)
  })

  it('skips when already audited this month', async () => {
    const prisma = makePrisma({ alreadyAudited: true })
    const result = await runSubscriptionAuditBatch(prisma)
    expect(result.sent).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when no subscription-category recurring payments', async () => {
    const prisma = makePrisma({
      recurring: [
        { merchantName: 'Tesco', merchantCategory: 'groceries', typicalAmount: new Decimal(50), frequency: 'monthly' },
      ],
    })
    const result = await runSubscriptionAuditBatch(prisma)
    expect(result.sent).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('normalises annual frequency to monthly cost', async () => {
    const prisma = makePrisma({
      recurring: [
        { merchantName: 'Amazon Prime', merchantCategory: 'subscriptions', typicalAmount: new Decimal(95), frequency: 'annual' },
      ],
    })
    const result = await runSubscriptionAuditBatch(prisma)
    expect(result.sent).toBe(1)
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    // £95 / 12 ≈ £7.92/month
    expect(msg).toMatch(/Amazon Prime/)
    expect(msg).toMatch(/7\.9/)
  })
})
