/**
 * Product analytics event tracker.
 *
 * Writes to the immutable AuditLog table with serviceName='analytics' so
 * product events are distinguishable from consent lifecycle events without
 * a separate table. Never throws — analytics failures must not disrupt flows.
 *
 * All queries that power the dashboard read from AuditLog filtered by
 * these event types.
 */
import type { PrismaClient } from '@prisma/client'

export type ProductEvent =
  | 'signup'             // user sent first WhatsApp message (new user created)
  | 'bank_connected'     // OAuth / mock bank connection successfully persisted
  | 'transaction_sync'   // full sync completed (success or partial)
  | 'first_question'     // first data-driven question after bank connected
  | 'question_answered'  // AI successfully responded to a data-driven question
  | 'ai_error'           // LLM call failed; fell back to structured text
  | 'sync_error'         // bank sync failed entirely

export async function trackEvent(
  prisma: PrismaClient,
  event: ProductEvent,
  userId: string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        eventType: event,
        eventData: data as never,
        serviceName: 'analytics',
      },
    })
  } catch {
    // Analytics failures must never disrupt the user-facing flow
  }
}

/**
 * Returns true if the user has at least one prior `question_answered` event,
 * meaning the current question is NOT the first.
 */
export async function hasAskedBefore(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const prior = await prisma.auditLog.findFirst({
    where: { userId, eventType: 'question_answered', serviceName: 'analytics' },
    select: { id: true },
  })
  return prior !== null
}
