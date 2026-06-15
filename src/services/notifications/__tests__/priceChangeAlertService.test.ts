import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { runPriceChangeAlertBatch } from '../priceChangeAlertService.js'

vi.mock('../../whatsapp/sender.js', () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wam-1' }) }))
vi.mock('../../../lib/crypto.js', () => ({ decrypt: vi.fn(() => Buffer.from('+447700900000')) }))
vi.mock('../../../config.js', () => ({
  config: { ENCRYPTION_KEY: 'a'.repeat(64), WHATSAPP_PHONE_NUMBER_ID: 'ph-1', WHATSAPP_ACCESS_TOKEN: 'tok-1' },
}))
vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

function makePrisma(opts: {
  recurring?: Array<{
    merchantName: string; merchantSlug: string; typicalAmount: Decimal
  }>
  lastTxAmount?: Decimal | null
  alreadyAlerted?: boolean
} = {}): PrismaClient {
  return {
    bankConnection: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) },
    recurringPayment: { findMany: vi.fn().mockResolvedValue(opts.recurring ?? []) },
    transaction: { findFirst: vi.fn().mockResolvedValue(opts.lastTxAmount != null ? { amount: opts.lastTxAmount } : null) },
    user: { findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: 'enc' }) },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(opts.alreadyAlerted ? { id: 'log-1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runPriceChangeAlertBatch', () => {
  beforeEach(() => { vi.mocked(sendWhatsAppMessage).mockClear() })

  it('sends alert when latest amount is >10% above typical', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'Netflix', merchantSlug: 'netflix', typicalAmount: new Decimal(10.99) }],
      lastTxAmount: new Decimal(13.99), // 27% increase
    })
    const result = await runPriceChangeAlertBatch(prisma)
    expect(result.alerted).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/Netflix/)
    expect(msg).toMatch(/price increase/i)
  })

  it('does not alert when increase is below 10% threshold', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'Spotify', merchantSlug: 'spotify', typicalAmount: new Decimal(10.99) }],
      lastTxAmount: new Decimal(11.49), // ~4.5% increase
    })
    const result = await runPriceChangeAlertBatch(prisma)
    expect(result.alerted).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when already alerted this month', async () => {
    const prisma = makePrisma({
      recurring: [{ merchantName: 'Netflix', merchantSlug: 'netflix', typicalAmount: new Decimal(10.99) }],
      lastTxAmount: new Decimal(14.99),
      alreadyAlerted: true,
    })
    const result = await runPriceChangeAlertBatch(prisma)
    expect(result.alerted).toBe(0)
  })

  it('returns zero alerted when no recurring payments', async () => {
    const prisma = makePrisma({ recurring: [] })
    const result = await runPriceChangeAlertBatch(prisma)
    expect(result.alerted).toBe(0)
    expect(result.processed).toBe(1)
  })
})
