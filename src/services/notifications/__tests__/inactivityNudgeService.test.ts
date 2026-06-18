import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { runInactivityNudgeBatch } from '../inactivityNudgeService.js'

vi.mock('../../whatsapp/sender.js', () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wam-1' }) }))
vi.mock('../../../lib/crypto.js', () => ({ decrypt: vi.fn(() => Buffer.from('+447700900000')) }))
vi.mock('../../../config.js', () => ({
  config: { ENCRYPTION_KEY: 'a'.repeat(64), WHATSAPP_PHONE_NUMBER_ID: 'ph-1', WHATSAPP_ACCESS_TOKEN: 'tok-1' },
}))
vi.mock('../../../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

function makePrisma(opts: {
  recentMessage?: boolean
  alreadyNudged?: boolean
  topCategory?: string
  balance?: number
} = {}): PrismaClient {
  const { recentMessage = false, alreadyNudged = false, topCategory = 'dining', balance = 500 } = opts
  return {
    bankConnection: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) },
    conversation: { findFirst: vi.fn().mockResolvedValue(recentMessage ? { id: 'conv-1' } : null) },
    user: { findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: 'enc' }) },
    transaction: {
      groupBy: vi.fn().mockResolvedValue([
        { category: topCategory, _sum: { amount: new Decimal(200) } },
      ]),
    },
    account: { findMany: vi.fn().mockResolvedValue([{ currentBalance: new Decimal(balance) }]) },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(alreadyNudged ? { id: 'log-1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runInactivityNudgeBatch', () => {
  beforeEach(() => { vi.mocked(sendWhatsAppMessage).mockClear() })

  it('sends nudge to inactive user with personalised insight', async () => {
    const prisma = makePrisma({ recentMessage: false })
    const result = await runInactivityNudgeBatch(prisma)
    expect(result.nudged).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/been a while/i)
    expect(msg).toMatch(/dining/)
  })

  it('skips active users who messaged recently', async () => {
    const prisma = makePrisma({ recentMessage: true })
    const result = await runInactivityNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips users nudged within the last 30 days', async () => {
    const prisma = makePrisma({ alreadyNudged: true })
    const result = await runInactivityNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('includes balance in message when no top category', async () => {
    const prisma = makePrisma({ recentMessage: false, balance: 1234 })
    // Override groupBy to return no spend data
    vi.mocked((prisma.transaction as unknown as { groupBy: ReturnType<typeof vi.fn> }).groupBy).mockResolvedValue([])
    const result = await runInactivityNudgeBatch(prisma)
    expect(result.nudged).toBe(1)
    const msg = vi.mocked(sendWhatsAppMessage).mock.calls[0]![1]
    expect(msg).toMatch(/1,234/)
  })
})
