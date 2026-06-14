import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { pruneOldSessions, SESSION_PRUNE_AGE_DAYS } from '../sessionService.js'

function makePrisma(deleteCount = 0) {
  return {
    conversation: {
      deleteMany: vi.fn().mockResolvedValue({ count: deleteCount }),
    },
  } as unknown as PrismaClient
}

describe('pruneOldSessions', () => {
  it('deletes conversations older than SESSION_PRUNE_AGE_DAYS', async () => {
    const prisma = makePrisma(42)
    const result = await pruneOldSessions(prisma)
    expect(result.deleted).toBe(42)
    expect(prisma.conversation.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('cutoff date is approximately SESSION_PRUNE_AGE_DAYS ago', async () => {
    const prisma = makePrisma(0)
    const before = Date.now()
    await pruneOldSessions(prisma)
    const after = Date.now()

    const call = (prisma.conversation.deleteMany as ReturnType<typeof vi.fn>).mock.calls[0]!
    const cutoff: Date = (call[0] as { where: { createdAt: { lt: Date } } }).where.createdAt.lt
    const expectedMs = SESSION_PRUNE_AGE_DAYS * 86_400_000
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expectedMs - 1000)
    expect(after - cutoff.getTime()).toBeLessThanOrEqual(expectedMs + 1000)
  })

  it('returns deleted: 0 when nothing is old enough', async () => {
    const prisma = makePrisma(0)
    const result = await pruneOldSessions(prisma)
    expect(result.deleted).toBe(0)
  })
})
