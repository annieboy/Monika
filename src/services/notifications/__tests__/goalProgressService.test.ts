import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { runGoalProgressBatch } from '../goalProgressService.js'

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
const GOAL_ID = 'goal-1'

function makePrisma(opts: {
  goals?: object[]
  lastNotifMilestone?: number | null
} = {}) {
  const goals = opts.goals ?? [
    {
      id: GOAL_ID,
      userId: USER_ID,
      name: 'Holiday',
      targetAmount: 2000,
      currentAmount: 1000,  // 50%
      lastProgressNotifiedAt: null,
    },
  ]

  return {
    savingsGoal: {
      findMany: vi.fn().mockResolvedValue(goals),
      update: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ whatsappPhoneEnc: Buffer.from('+447700000001') }),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(
        opts.lastNotifMilestone != null
          ? { eventData: { milestone: opts.lastNotifMilestone } }
          : null,
      ),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runGoalProgressBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a notification when user crosses 50% milestone for first time', async () => {
    const prisma = makePrisma()
    const result = await runGoalProgressBatch(prisma)
    expect(result.notified).toBe(1)
    expect(result.errors).toBe(0)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const [, msg] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(msg).toMatch(/50%/)
    expect(msg).toMatch(/Holiday/)
  })

  it('skips notification when milestone already sent', async () => {
    const prisma = makePrisma({ lastNotifMilestone: 50 })
    const result = await runGoalProgressBatch(prisma)
    expect(result.notified).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('sends 100% notification and marks goal achieved', async () => {
    const prisma = makePrisma({
      goals: [{ id: GOAL_ID, userId: USER_ID, name: 'Car', targetAmount: 5000, currentAmount: 5000, lastProgressNotifiedAt: null }],
      lastNotifMilestone: 75,
    })
    const result = await runGoalProgressBatch(prisma)
    expect(result.notified).toBe(1)
    const [, msg] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(msg).toMatch(/Amazing work/i)
    // Should update status to achieved
    const updateCall = (prisma.savingsGoal.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCall.some((c: unknown[]) => (c[0] as { data: { status?: string } }).data?.status === 'achieved')).toBe(true)
  })

  it('skips goal with zero target amount', async () => {
    const prisma = makePrisma({
      goals: [{ id: GOAL_ID, userId: USER_ID, name: 'Empty', targetAmount: 0, currentAmount: 0, lastProgressNotifiedAt: null }],
    })
    const result = await runGoalProgressBatch(prisma)
    expect(result.notified).toBe(0)
  })

  it('skips user with no phone', async () => {
    const prisma = makePrisma()
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const result = await runGoalProgressBatch(prisma)
    expect(result.notified).toBe(0)
  })

  it('counts errors without throwing', async () => {
    const prisma = makePrisma()
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB down'))
    const result = await runGoalProgressBatch(prisma)
    expect(result.errors).toBe(1)
    expect(result.notified).toBe(0)
  })
})
