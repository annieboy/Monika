import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { runExpiryNudgeBatch } from '../expiryNudgeService.js'

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockImplementation((buf: Buffer) => buf),
}))

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid-001' }),
}))

vi.mock('../../affiliate/clickTrackingService.js', () => ({
  generateClickUrl: vi.fn().mockResolvedValue('https://monika.test/r/abc12345'),
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
const OPP_ID = 'opp-1'

function makeOpportunity(hoursUntilExpiry = 24) {
  return {
    id: OPP_ID,
    userId: USER_ID,
    offerId: 'offer-1',
    expiresAt: new Date(Date.now() + hoursUntilExpiry * 3_600_000),
    offer: { title: 'Premium Account', providerName: 'Acme Bank', shortDescription: 'Switch and earn £150' },
  }
}

function makePrisma(opts: { alreadyNudged?: boolean; opportunities?: object[] } = {}) {
  return {
    opportunity: {
      findMany: vi.fn().mockResolvedValue(opts.opportunities ?? [makeOpportunity()]),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: Buffer.from('+447700000001') }),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(opts.alreadyNudged ? { id: 'log-1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runExpiryNudgeBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends an expiry nudge for a qualifying opportunity', async () => {
    const prisma = makePrisma()
    const result = await runExpiryNudgeBatch(prisma)
    expect(result.nudged).toBe(1)
    expect(result.errors).toBe(0)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const [, msg] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(msg).toMatch(/Last chance/i)
    expect(msg).toMatch(/Acme Bank/)
    expect(msg).toMatch(/monika\.test\/r\//)
  })

  it('skips opportunities already nudged', async () => {
    const prisma = makePrisma({ alreadyNudged: true })
    const result = await runExpiryNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips users with no phone', async () => {
    const prisma = makePrisma()
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const result = await runExpiryNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
  })

  it('counts errors without throwing', async () => {
    const prisma = makePrisma()
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))
    const result = await runExpiryNudgeBatch(prisma)
    expect(result.errors).toBe(1)
    expect(result.nudged).toBe(0)
  })

  it('returns zero when no qualifying opportunities exist', async () => {
    const prisma = makePrisma({ opportunities: [] })
    const result = await runExpiryNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
    expect(result.errors).toBe(0)
  })
})
