import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wam-1' }),
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
  logger: { info: vi.fn(), error: vi.fn() },
}))

import { checkAndAlertLargeTransaction, ALERT_MULTIPLIER, ALERT_MIN_AMOUNT } from '../largeTransactionAlertService.js'
import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

function makePrisma(opts: {
  tx?: object | null
  histAvg?: number
  histCount?: number
  rateLimitHit?: boolean
}) {
  const { tx = null, histAvg = 20, histCount = 5, rateLimitHit = false } = opts
  return {
    transaction: {
      findUnique: vi.fn().mockResolvedValue(tx),
      aggregate: vi.fn().mockResolvedValue({
        _avg: { amount: -histAvg },
        _count: { id: histCount },
      }),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(rateLimitHit ? { id: 'x' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: 'enc' }),
    },
  } as unknown as PrismaClient
}

describe('checkAndAlertLargeTransaction', () => {
  beforeEach(() => vi.mocked(sendWhatsAppMessage).mockClear())

  it('skips non-debit transactions', async () => {
    const prisma = makePrisma({ tx: { amount: 100, merchantNameClean: null, merchantName: null, transactionDate: new Date() } })
    const result = await checkAndAlertLargeTransaction(prisma, 'u1', 'tx-1')
    expect(result.alerted).toBe(false)
    expect(result.reason).toBe('not_a_debit')
  })

  it('skips transactions below minimum amount', async () => {
    const prisma = makePrisma({ tx: { amount: -(ALERT_MIN_AMOUNT - 1), merchantNameClean: null, merchantName: null, transactionDate: new Date() } })
    const result = await checkAndAlertLargeTransaction(prisma, 'u1', 'tx-1')
    expect(result.alerted).toBe(false)
    expect(result.reason).toBe('below_minimum')
  })

  it('skips when insufficient history', async () => {
    const prisma = makePrisma({
      tx: { amount: -200, merchantNameClean: 'Tesco', merchantName: 'TESCO', transactionDate: new Date() },
      histCount: 2,
    })
    const result = await checkAndAlertLargeTransaction(prisma, 'u1', 'tx-1')
    expect(result.alerted).toBe(false)
    expect(result.reason).toBe('insufficient_history')
  })

  it('skips when amount is within normal range', async () => {
    const prisma = makePrisma({
      tx: { amount: -50, merchantNameClean: 'Tesco', merchantName: 'TESCO', transactionDate: new Date() },
      histAvg: 40,   // 50 < 40 * 3 = 120
      histCount: 10,
    })
    const result = await checkAndAlertLargeTransaction(prisma, 'u1', 'tx-1')
    expect(result.alerted).toBe(false)
    expect(result.reason).toBe('within_normal_range')
  })

  it('sends alert when transaction is > 3× average', async () => {
    const avg = 30
    const amount = avg * (ALERT_MULTIPLIER + 1)  // 4× average
    const prisma = makePrisma({
      tx: { amount: -amount, merchantNameClean: 'Amazon', merchantName: 'AMAZON', transactionDate: new Date() },
      histAvg: avg,
      histCount: 10,
    })
    const result = await checkAndAlertLargeTransaction(prisma, 'u1', 'tx-1')
    expect(result.alerted).toBe(true)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/Large transaction alert/)
    expect(msg).toMatch(/Amazon/)
  })

  it('skips when rate limited', async () => {
    const avg = 30
    const amount = avg * 4
    const prisma = makePrisma({
      tx: { amount: -amount, merchantNameClean: 'Amazon', merchantName: 'AMAZON', transactionDate: new Date() },
      histAvg: avg,
      histCount: 10,
      rateLimitHit: true,
    })
    const result = await checkAndAlertLargeTransaction(prisma, 'u1', 'tx-1')
    expect(result.alerted).toBe(false)
    expect(result.reason).toBe('rate_limited')
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns not_found for unknown transaction', async () => {
    const prisma = makePrisma({ tx: null })
    const result = await checkAndAlertLargeTransaction(prisma, 'u1', 'tx-unknown')
    expect(result.alerted).toBe(false)
    expect(result.reason).toBe('transaction_not_found')
  })
})
