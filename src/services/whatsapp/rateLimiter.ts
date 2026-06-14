/**
 * WhatsApp outbound message rate limiter.
 *
 * Enforces per-user limits to comply with Meta's policies and prevent spam:
 *   - Max 5 proactive messages per user per 24 hours (Meta policy)
 *   - Max 1 message per user per 60 seconds (burst protection)
 *   - Proactive vs reactive distinction: reactive replies to user messages
 *     are exempt from the 24h proactive limit
 *
 * Storage: backed by auditLog (append-only) for proactive-message counting,
 * plus an in-memory map for burst-rate (resets on process restart, acceptable
 * for burst protection — auditLog is the durable source of truth).
 *
 * Usage:
 *   const limiter = new WhatsAppRateLimiter(prisma)
 *   if (await limiter.checkProactive(userId)) {
 *     await sendWhatsAppMessage(...)
 *     await limiter.recordProactive(userId)
 *   }
 */
import type { PrismaClient, Prisma } from '@prisma/client'

export const PROACTIVE_DAILY_LIMIT = 5
export const BURST_WINDOW_MS = 60_000      // 1 minute
export const PROACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface RateLimitResult {
  allowed: boolean
  reason?: 'daily_limit' | 'burst_limit'
  retryAfterMs?: number
}

// In-memory last-send timestamp per userId (burst protection only)
const lastSentAt = new Map<string, number>()

export class WhatsAppRateLimiter {
  constructor(private readonly prisma: PrismaClient) {}

  /** Check if a proactive message is allowed for this user. */
  async checkProactive(userId: string, now = Date.now()): Promise<RateLimitResult> {
    // Burst check (in-memory)
    const lastMs = lastSentAt.get(userId)
    if (lastMs !== undefined && now - lastMs < BURST_WINDOW_MS) {
      return {
        allowed: false,
        reason: 'burst_limit',
        retryAfterMs: BURST_WINDOW_MS - (now - lastMs),
      }
    }

    // Daily proactive limit (durable, via auditLog)
    const windowStart = new Date(now - PROACTIVE_WINDOW_MS)
    const recentCount = await this.prisma.auditLog.count({
      where: {
        userId,
        eventType: 'proactive_message_sent',
        createdAt: { gte: windowStart },
      },
    })

    if (recentCount >= PROACTIVE_DAILY_LIMIT) {
      return {
        allowed: false,
        reason: 'daily_limit',
        retryAfterMs: PROACTIVE_WINDOW_MS,
      }
    }

    return { allowed: true }
  }

  /** Record that a proactive message was sent. */
  async recordProactive(userId: string, meta: Record<string, unknown> = {}): Promise<void> {
    lastSentAt.set(userId, Date.now())
    await this.prisma.auditLog.create({
      data: {
        userId,
        eventType: 'proactive_message_sent',
        serviceName: 'whatsapp-rate-limiter',
        eventData: meta as Prisma.InputJsonValue,
      },
    })
  }

  /** Record a reactive send (user initiated — updates burst tracker only). */
  recordReactive(userId: string): void {
    lastSentAt.set(userId, Date.now())
  }

  /** Reset the in-memory burst state for a user (for testing). */
  resetBurst(userId: string): void {
    lastSentAt.delete(userId)
  }
}
