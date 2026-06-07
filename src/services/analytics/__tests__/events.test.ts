import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { trackEvent, hasAskedBefore } from '../events.js'

function makePrisma(overrides: Partial<PrismaClient> = {}): PrismaClient {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: BigInt(1) }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  } as unknown as PrismaClient
}

describe('trackEvent', () => {
  it('writes to auditLog with serviceName analytics', async () => {
    const prisma = makePrisma()

    await trackEvent(prisma, 'signup', 'user-1', { wabaId: 'waba-123' })

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'signup',
        userId: 'user-1',
        serviceName: 'analytics',
        eventData: { wabaId: 'waba-123' },
      }),
    })
  })

  it('accepts null userId', async () => {
    const prisma = makePrisma()

    await trackEvent(prisma, 'sync_error', null, { reason: 'timeout' })

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, eventType: 'sync_error' }),
    })
  })

  it('never throws when prisma fails', async () => {
    const prisma = makePrisma({
      auditLog: { create: vi.fn().mockRejectedValue(new Error('DB down')) } as unknown as PrismaClient['auditLog'],
    })

    await expect(trackEvent(prisma, 'signup', 'u1')).resolves.toBeUndefined()
  })

  it('works with no event data (defaults to empty object)', async () => {
    const prisma = makePrisma()

    await trackEvent(prisma, 'question_answered', 'u1')

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventData: {} }),
    })
  })
})

describe('hasAskedBefore', () => {
  it('returns false when no prior question_answered event', async () => {
    const prisma = makePrisma()
    ;(prisma.auditLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const result = await hasAskedBefore(prisma, 'user-1')
    expect(result).toBe(false)
  })

  it('returns true when a prior question_answered event exists', async () => {
    const prisma = makePrisma()
    ;(prisma.auditLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BigInt(42) })

    const result = await hasAskedBefore(prisma, 'user-1')
    expect(result).toBe(true)
  })

  it('queries by userId and eventType and serviceName', async () => {
    const prisma = makePrisma()

    await hasAskedBefore(prisma, 'user-abc')

    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-abc', eventType: 'question_answered', serviceName: 'analytics' },
      select: { id: true },
    })
  })
})

describe('trackEvent — event types', () => {
  const events = [
    'signup',
    'bank_connected',
    'transaction_sync',
    'first_question',
    'question_answered',
    'ai_error',
    'sync_error',
  ] as const

  for (const event of events) {
    it(`accepts event type: ${event}`, async () => {
      const prisma = makePrisma()
      await trackEvent(prisma, event, null)
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: event }),
      })
    })
  }
})
