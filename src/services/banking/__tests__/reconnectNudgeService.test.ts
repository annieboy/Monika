import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../onboarding/token.js', () => ({
  generateOnboardingToken: vi.fn().mockResolvedValue('one-time-token-123'),
}))

vi.mock('../../onboarding/audit.js', () => ({
  logConsentEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('+447911123456')),
}))

vi.mock('../../../config.js', () => ({
  config: {
    ENCRYPTION_KEY: 'key',
    WHATSAPP_PHONE_NUMBER_ID: 'pid',
    WHATSAPP_ACCESS_TOKEN: 'tok',
    APP_BASE_URL: 'https://monika.app',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
  },
}))

vi.mock('../../../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { runReconnectNudgeBatch } from '../reconnectNudgeService.js'
import { sendWhatsAppMessage } from '../../whatsapp/sender.js'
import { logConsentEvent } from '../../onboarding/audit.js'

const USER_ID = 'user-1'
const CONN_ID = 'conn-1'

function makePrisma(opts: {
  failingConnections?: Array<{ id: string; userId: string; bankDisplayName: string }>
  hasNudgedRecently?: boolean
  hasPhone?: boolean
} = {}) {
  const failingConnections = opts.failingConnections ?? [
    { id: CONN_ID, userId: USER_ID, bankDisplayName: 'Barclays' },
  ]

  return {
    bankConnection: {
      findMany: vi.fn().mockResolvedValue(failingConnections),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(opts.hasNudgedRecently ? { id: 'log-1' } : null),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(
        opts.hasPhone !== false ? { whatsappPhoneEnc: 'enc' } : { whatsappPhoneEnc: null },
      ),
    },
    onboardingToken: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('runReconnectNudgeBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends reconnection link when connection has been failing', async () => {
    const prisma = makePrisma()
    const result = await runReconnectNudgeBatch(prisma)
    expect(result.nudged).toBe(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
    const [, msg] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, string, ...unknown[]]
    expect(msg).toContain('Barclays')
    expect(msg).toContain('https://monika.app/banking/start')
  })

  it('logs audit event with connectionId', async () => {
    const prisma = makePrisma()
    await runReconnectNudgeBatch(prisma)
    expect(logConsentEvent).toHaveBeenCalledWith(
      prisma,
      'bank_reconnect_nudge_sent',
      USER_ID,
      expect.objectContaining({ connectionId: CONN_ID }),
    )
  })

  it('skips when nudged recently', async () => {
    const prisma = makePrisma({ hasNudgedRecently: true })
    const result = await runReconnectNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('skips when user has no phone', async () => {
    const prisma = makePrisma({ hasPhone: false })
    const result = await runReconnectNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns nudged: 0 when no failing connections', async () => {
    const prisma = makePrisma({ failingConnections: [] })
    const result = await runReconnectNudgeBatch(prisma)
    expect(result.nudged).toBe(0)
    expect(result.errors).toBe(0)
  })

  it('counts errors and continues when one user throws', async () => {
    const prisma = {
      bankConnection: {
        findMany: vi.fn().mockResolvedValue([{ id: CONN_ID, userId: USER_ID, bankDisplayName: 'Test' }]),
      },
      auditLog: {
        findFirst: vi.fn().mockRejectedValue(new Error('DB error')),
      },
      user: { findUnique: vi.fn() },
      onboardingToken: { create: vi.fn() },
    } as unknown as PrismaClient
    const result = await runReconnectNudgeBatch(prisma)
    expect(result.errors).toBe(1)
    expect(result.nudged).toBe(0)
  })
})
