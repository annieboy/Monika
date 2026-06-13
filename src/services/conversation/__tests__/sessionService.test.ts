import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getOrCreateSession, loadSessionHistory, SESSION_TIMEOUT_MS, MAX_HISTORY_MESSAGES } from '../sessionService.js'

function makePrisma(latest: { sessionId: string; createdAt: Date } | null = null): PrismaClient {
  return {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(latest),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient
}

describe('getOrCreateSession', () => {
  it('returns a new UUID when user has no conversations', async () => {
    const prisma = makePrisma(null)
    const sessionId = await getOrCreateSession(prisma, 'user-1')

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    )
  })

  it('reuses the existing session when within timeout window', async () => {
    const existingSession = 'session-abc'
    const recentCreatedAt = new Date(Date.now() - 30 * 60 * 1000) // 30 min ago
    const prisma = makePrisma({ sessionId: existingSession, createdAt: recentCreatedAt })

    const sessionId = await getOrCreateSession(prisma, 'user-1')
    expect(sessionId).toBe(existingSession)
  })

  it('starts a new session when last message is beyond timeout', async () => {
    const existingSession = 'session-old'
    const staleCreatedAt = new Date(Date.now() - SESSION_TIMEOUT_MS - 1000) // just over 2h
    const prisma = makePrisma({ sessionId: existingSession, createdAt: staleCreatedAt })

    const sessionId = await getOrCreateSession(prisma, 'user-1')
    expect(sessionId).not.toBe(existingSession)
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('starts a new session exactly at the timeout boundary', async () => {
    const existingSession = 'session-boundary'
    const boundaryCreatedAt = new Date(Date.now() - SESSION_TIMEOUT_MS)
    const prisma = makePrisma({ sessionId: existingSession, createdAt: boundaryCreatedAt })

    const sessionId = await getOrCreateSession(prisma, 'user-1')
    expect(sessionId).not.toBe(existingSession)
  })
})

describe('loadSessionHistory', () => {
  it('returns empty array when session has no history', async () => {
    const prisma = makePrisma()
    const history = await loadSessionHistory(prisma, 'user-1', 'session-1')
    expect(history).toEqual([])
  })

  it('returns messages in chronological order (oldest first)', async () => {
    // findMany is called with orderBy: desc, so the mock returns newest-first
    // After our reverse(), oldest (user) should come first
    const rows = [
      { role: 'user', content: 'How much can I spend?' },      // newest (desc order)
      { role: 'assistant', content: 'Your balance is £500.' }, // oldest (desc order)
    ]
    const prisma = makePrisma()
    vi.mocked(prisma.conversation.findMany).mockResolvedValueOnce(rows as never)

    const history = await loadSessionHistory(prisma, 'user-1', 'session-1')

    // After reverse: oldest = assistant message should be first
    expect(history[0]?.role).toBe('assistant')
    expect(history[1]?.role).toBe('user')
  })

  it('queries only user and assistant roles', async () => {
    const prisma = makePrisma()
    await loadSessionHistory(prisma, 'user-1', 'session-1')

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['user', 'assistant'] },
        }),
      }),
    )
  })

  it('limits to MAX_HISTORY_MESSAGES', async () => {
    const prisma = makePrisma()
    await loadSessionHistory(prisma, 'user-1', 'session-1')

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_HISTORY_MESSAGES }),
    )
  })

  it('filters by userId and sessionId', async () => {
    const prisma = makePrisma()
    await loadSessionHistory(prisma, 'user-xyz', 'session-abc')

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-xyz', sessionId: 'session-abc' }),
      }),
    )
  })
})
