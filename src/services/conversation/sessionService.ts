/**
 * Conversation session management.
 *
 * A "session" groups messages that belong to the same continuous conversation.
 * A new session starts when the user has been silent for SESSION_TIMEOUT_MS or
 * longer. Within a session, recent messages are loaded and passed to the AI so
 * it can answer follow-up questions without losing context.
 *
 * Design:
 *   - getOrCreateSession  — look up the latest session for a user; reuse it if
 *                           within the timeout window, otherwise return a fresh UUID.
 *   - loadSessionHistory  — fetch the N most recent messages in a session and
 *                           return them as Anthropic-compatible message objects.
 *   - pruneOldSessions    — housekeeping; called nightly by the scheduler.
 */
import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'

// A new session begins after this much silence
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000   // 2 hours

// Maximum messages to include as context (user + assistant pairs)
export const MAX_HISTORY_MESSAGES = 10

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Returns the active sessionId for a user, or a new UUID if:
 *  - the user has no previous conversations, or
 *  - the most recent conversation is older than SESSION_TIMEOUT_MS.
 */
export async function getOrCreateSession(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const latest = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { sessionId: true, createdAt: true },
  })

  if (!latest) return randomUUID()

  const idleMs = Date.now() - latest.createdAt.getTime()
  if (idleMs >= SESSION_TIMEOUT_MS) return randomUUID()

  return latest.sessionId
}

/**
 * Loads up to MAX_HISTORY_MESSAGES recent messages from the given session,
 * ordered oldest-first so they can be passed directly to the Anthropic API.
 * The current in-flight user message is NOT included here — it's appended
 * separately by the caller.
 */
export async function loadSessionHistory(
  prisma: PrismaClient,
  userId: string,
  sessionId: string,
): Promise<HistoryMessage[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      userId,
      sessionId,
      role: { in: ['user', 'assistant'] },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true },
  })

  // Reverse so oldest is first (Anthropic expects chronological order)
  return rows.reverse().map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.content,
  }))
}

// Sessions older than this are pruned nightly
export const SESSION_PRUNE_AGE_DAYS = 90

export interface PruneResult {
  deleted: number
}

/**
 * Deletes conversation rows older than SESSION_PRUNE_AGE_DAYS.
 * Safe to run repeatedly — only removes old data, never touches recent sessions.
 */
export async function pruneOldSessions(prisma: PrismaClient): Promise<PruneResult> {
  const cutoff = new Date(Date.now() - SESSION_PRUNE_AGE_DAYS * 86_400_000)
  const result = await prisma.conversation.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return { deleted: result.count }
}
