import type { PrismaClient } from '@prisma/client'

export type ConsentEvent =
  | 'bank_connect_link_sent'
  | 'bank_connect_token_opened'
  | 'bank_connect_completed'
  | 'bank_connect_failed'
  | 'bank_connect_token_expired'
  | 'bank_connect_token_already_used'
  | 'bank_connect_token_not_found'

/**
 * Appends an immutable audit log entry for a consent lifecycle event.
 * Never throws — failures are swallowed so they cannot disrupt the main flow.
 */
export async function logConsentEvent(
  prisma: PrismaClient,
  event: ConsentEvent,
  userId: string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        eventType: event,
        eventData: data as never,
        serviceName: 'onboarding',
      },
    })
  } catch {
    // Audit failures must never break the user-facing flow
  }
}
