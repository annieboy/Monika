import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { runLowBalanceAlertBatch } from '../lowBalanceAlertService.js'

vi.mock('../../whatsapp/sender.js', () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wam-1' }) }))
vi.mock('../../../lib/crypto.js', () => ({ decrypt: vi.fn(() => Buffer.from('+447700900000')) }))
vi.mock('../../../config.js', () => ({
  config: { ENCRYPTION_KEY: 'a'.repeat(64), WHATSAPP_PHONE_NUMBER_ID: 'ph-1', WHATSAPP_ACCESS_TOKEN: 'tok-1' },
}))
vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

function makePrisma(opts: {
  balance?: number
  monthlySpend?: number
  alreadyAlerted?: boolean
} = {}): PrismaClient {
  const { balance = 200, monthlySpend = 1500, alreadyAlerted = false } = opts
  return {
    bankConnection: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) },
    account: {
      findMany: vi.fn().mockResolvedValue([
        { currentBalance: new Decimal(balance), accountType: 'current' },
      ]),
    },
    transaction: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: new Decimal(monthlySpend) } }),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: 'enc' }) },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(alreadyAlerted ? { id: 'log-1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runLowBalanceAlertBatch', () => {
  beforeEach(() => { vi.mocked(sendWhatsAppMessage).mockClear() })

  it('sends alert when balance is below 7-day threshold', async () => {
    // Monthly spend £1500 → daily £50 → 7-day threshold £350
    // Balance £200 < £350 → alert
    const prisma = makePrisma({ balance: 200, monthlySpend: 1500 })
    const result = await runLowBalanceAlertBatch(prisma)
    expect(result.alerted).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/low balance/i)
  })

  it('does not alert when balance is above threshold', async () => {
    // Monthly spend £600 → daily £20 → 7-day threshold £140 → use min £100
    // Balance £1000 > £140 → no alert
    const prisma = makePrisma({ balance: 1000, monthlySpend: 600 })
    const result = await runLowBalanceAlertBatch(prisma)
    expect(result.alerted).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when already alerted recently', async () => {
    const prisma = makePrisma({ balance: 50, monthlySpend: 1500, alreadyAlerted: true })
    const result = await runLowBalanceAlertBatch(prisma)
    expect(result.alerted).toBe(0)
  })
})
