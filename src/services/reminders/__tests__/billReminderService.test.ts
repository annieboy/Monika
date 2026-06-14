import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('+447911123456')),
}))

vi.mock('../../../config.js', () => ({
  config: {
    ENCRYPTION_KEY: 'test-key',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_ACCESS_TOKEN: 'token',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
  },
}))

vi.mock('../../../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { runBillReminderBatch } from '../billReminderService.js'
import { sendWhatsAppMessage } from '../../whatsapp/sender.js'

const USER_ID = 'user-1'

// Build a day-of-month that falls within the next 3 days
function dayDueIn(days: number): number {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.getDate()
}

function makePrisma(opts: {
  hasRemindedRecently?: boolean
  recurringPayments?: Array<{ merchantName: string; dayOfMonth: number; amount: number }>
  hasPhone?: boolean
} = {}) {
  const { hasRemindedRecently = false, recurringPayments = [], hasPhone = true } = opts

  return {
    bankConnection: {
      findMany: vi.fn().mockResolvedValue([{ userId: USER_ID }]),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(hasRemindedRecently ? { id: 'log-1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
    recurringPayment: {
      findMany: vi.fn().mockResolvedValue(
        recurringPayments.map(p => ({
          merchantName: p.merchantName,
          lastSeenDate: new Date(new Date().getFullYear(), new Date().getMonth(), p.dayOfMonth),
          averageAmount: -p.amount,
          status: 'active',
        })),
      ),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(hasPhone ? { whatsappPhoneEnc: 'encrypted' } : { whatsappPhoneEnc: null }),
    },
  } as unknown as PrismaClient
}

describe('runBillReminderBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends reminder when payment is due within 3 days', async () => {
    const prisma = makePrisma({
      recurringPayments: [{ merchantName: 'Netflix', dayOfMonth: dayDueIn(1), amount: 15 }],
    })
    const result = await runBillReminderBatch(prisma)
    expect(result.reminded).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'bill_reminder_sent' }),
      }),
    )
  })

  it('skips when user was reminded within 6 days', async () => {
    const prisma = makePrisma({
      hasRemindedRecently: true,
      recurringPayments: [{ merchantName: 'Gym', dayOfMonth: dayDueIn(2), amount: 40 }],
    })
    const result = await runBillReminderBatch(prisma)
    expect(result.reminded).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when no bills due within window', async () => {
    const prisma = makePrisma({ recurringPayments: [] })
    const result = await runBillReminderBatch(prisma)
    expect(result.reminded).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when user has no phone number', async () => {
    const prisma = makePrisma({
      recurringPayments: [{ merchantName: 'Spotify', dayOfMonth: dayDueIn(0), amount: 10 }],
      hasPhone: false,
    })
    const result = await runBillReminderBatch(prisma)
    expect(result.reminded).toBe(0)
  })

  it('counts errors and continues when a user throws', async () => {
    const prisma = {
      bankConnection: {
        findMany: vi.fn().mockResolvedValue([{ userId: USER_ID }]),
      },
      auditLog: {
        findFirst: vi.fn().mockRejectedValue(new Error('DB error')),
        create: vi.fn(),
      },
      recurringPayment: { findMany: vi.fn() },
      user: { findUnique: vi.fn() },
    } as unknown as PrismaClient

    const result = await runBillReminderBatch(prisma)
    expect(result.errors).toBe(1)
    expect(result.reminded).toBe(0)
  })
})
