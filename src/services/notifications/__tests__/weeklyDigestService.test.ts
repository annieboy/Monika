import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { runWeeklyDigestBatch } from '../weeklyDigestService.js'

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockImplementation((buf: Buffer) => buf),
}))

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid-001' }),
}))

vi.mock('../../../config.js', () => ({
  config: {
    ENCRYPTION_KEY: '0'.repeat(64),
    WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_ACCESS_TOKEN: 'access-token',
  },
}))

vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

const USER_ID = 'user-1'

function makePrisma(opts: {
  thisWeekSpend?: number
  lastWeekSpend?: number
  topCategory?: string | null
  lastDigestAge?: number   // ms since last digest
} = {}) {
  const { thisWeekSpend = 250, lastWeekSpend = 200, topCategory = 'Groceries', lastDigestAge = 8 * 86_400_000 } = opts

  return {
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: USER_ID }]),
      findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: Buffer.from('+447700000001') }),
    },
    transaction: {
      aggregate: vi.fn()
        .mockResolvedValueOnce({ _sum: { amount: -thisWeekSpend } })   // this week
        .mockResolvedValueOnce({ _sum: { amount: -lastWeekSpend } }),  // last week
      groupBy: vi.fn().mockResolvedValue(
        topCategory ? [{ category: topCategory, _sum: { amount: -80 } }] : [],
      ),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(
        lastDigestAge < 6 * 86_400_000
          ? { createdAt: new Date(Date.now() - lastDigestAge) }
          : null,
      ),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runWeeklyDigestBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a digest with spend and category', async () => {
    const prisma = makePrisma()
    const result = await runWeeklyDigestBatch(prisma)
    expect(result.sent).toBe(1)
    expect(result.errors).toBe(0)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const [, msg] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(msg).toMatch(/£250/)
    expect(msg).toMatch(/Groceries/)
  })

  it('skips users sent a digest within 6 days', async () => {
    const prisma = makePrisma({ lastDigestAge: 2 * 86_400_000 })
    const result = await runWeeklyDigestBatch(prisma)
    expect(result.sent).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips users with zero spending this week', async () => {
    const prisma = makePrisma({ thisWeekSpend: 0 })
    const result = await runWeeklyDigestBatch(prisma)
    expect(result.sent).toBe(0)
  })

  it('shows "more than last week" when spend is higher', async () => {
    const prisma = makePrisma({ thisWeekSpend: 300, lastWeekSpend: 200 })
    await runWeeklyDigestBatch(prisma)
    const [, msg] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(msg).toMatch(/more than last week/)
  })

  it('shows "less than last week" when spend is lower', async () => {
    const prisma = makePrisma({ thisWeekSpend: 150, lastWeekSpend: 200 })
    await runWeeklyDigestBatch(prisma)
    const [, msg] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(msg).toMatch(/less than last week/)
  })

  it('counts errors without throwing', async () => {
    const prisma = makePrisma()
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))
    const result = await runWeeklyDigestBatch(prisma)
    expect(result.errors).toBe(1)
  })
})
