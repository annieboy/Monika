import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WhatsAppRateLimiter, PROACTIVE_DAILY_LIMIT, BURST_WINDOW_MS } from '../rateLimiter.js'

const NOW_MS = new Date('2026-03-15T12:00:00Z').getTime()

function makePrisma(recentCount = 0) {
  return {
    auditLog: {
      count: vi.fn().mockResolvedValue(recentCount),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('WhatsAppRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('allows when no prior sends', async () => {
    vi.setSystemTime(NOW_MS)
    const limiter = new WhatsAppRateLimiter(makePrisma(0))
    limiter.resetBurst('u1')
    const result = await limiter.checkProactive('u1', NOW_MS)
    expect(result.allowed).toBe(true)
  })

  it('blocks when daily limit reached', async () => {
    vi.setSystemTime(NOW_MS)
    const limiter = new WhatsAppRateLimiter(makePrisma(PROACTIVE_DAILY_LIMIT))
    limiter.resetBurst('u1')
    const result = await limiter.checkProactive('u1', NOW_MS)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('daily_limit')
  })

  it('blocks when burst limit hit (< 60s since last send)', async () => {
    vi.setSystemTime(NOW_MS)
    const limiter = new WhatsAppRateLimiter(makePrisma(0))
    limiter.resetBurst('u1')
    await limiter.recordProactive('u1')   // sets lastSentAt
    const result = await limiter.checkProactive('u1', NOW_MS + 30_000) // 30s later
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('burst_limit')
  })

  it('allows after burst window has passed', async () => {
    vi.setSystemTime(NOW_MS)
    const limiter = new WhatsAppRateLimiter(makePrisma(0))
    limiter.resetBurst('u1')
    await limiter.recordProactive('u1')
    const result = await limiter.checkProactive('u1', NOW_MS + BURST_WINDOW_MS + 1)
    expect(result.allowed).toBe(true)
  })

  it('recordProactive creates auditLog entry', async () => {
    vi.setSystemTime(NOW_MS)
    const prisma = makePrisma(0)
    const limiter = new WhatsAppRateLimiter(prisma)
    limiter.resetBurst('u1')
    await limiter.recordProactive('u1', { intent: 'weekly_digest' })
    expect(prisma.auditLog.create).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]
    expect(call.data.eventType).toBe('proactive_message_sent')
    expect(call.data.eventData).toMatchObject({ intent: 'weekly_digest' })
  })

  it('returns retryAfterMs for burst block', async () => {
    vi.setSystemTime(NOW_MS)
    const limiter = new WhatsAppRateLimiter(makePrisma(0))
    limiter.resetBurst('u1')
    await limiter.recordProactive('u1')
    const result = await limiter.checkProactive('u1', NOW_MS + 20_000)
    expect(result.retryAfterMs).toBe(BURST_WINDOW_MS - 20_000)
  })

  it('recordReactive updates burst tracker without auditLog', () => {
    vi.setSystemTime(NOW_MS)
    const prisma = makePrisma(0)
    const limiter = new WhatsAppRateLimiter(prisma)
    limiter.resetBurst('u1')
    limiter.recordReactive('u1')
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })
})
