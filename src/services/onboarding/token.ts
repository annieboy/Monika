import { randomBytes } from 'crypto'
import type { PrismaClient } from '@prisma/client'

const TOKEN_TTL_MS = 15 * 60 * 1000  // 15 minutes

/**
 * Generates a cryptographically random 256-bit (64-char hex) one-time token
 * for the bank connection consent flow, stored in the onboarding_tokens table.
 */
export async function generateOnboardingToken(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await prisma.onboardingToken.create({
    data: {
      token,
      userId,
      purpose: 'bank_connect',
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  })
  return token
}

export type TokenValidationResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_found' | 'wrong_purpose' | 'already_used' | 'expired' }

/**
 * Validates a token and atomically marks it as used in a single transaction.
 *
 * Atomicity guarantee: the SELECT and UPDATE run inside a serializable
 * transaction so concurrent requests with the same token cannot both succeed.
 * The second request will either see usedAt already set (optimistic path) or
 * hit a serialization error that the client retries — either way only one
 * request wins.
 */
export async function validateAndConsumeToken(
  prisma: PrismaClient,
  token: string,
): Promise<TokenValidationResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const record = await tx.onboardingToken.findUnique({
          where: { token },
          select: { userId: true, expiresAt: true, usedAt: true, purpose: true },
        })

        if (!record) return { ok: false, reason: 'not_found' as const }
        if (record.purpose !== 'bank_connect') return { ok: false, reason: 'wrong_purpose' as const }
        if (record.usedAt !== null) return { ok: false, reason: 'already_used' as const }
        if (record.expiresAt < new Date()) return { ok: false, reason: 'expired' as const }

        await tx.onboardingToken.update({
          where: { token },
          data: { usedAt: new Date() },
        })

        return { ok: true, userId: record.userId }
      },
      { isolationLevel: 'Serializable' },
    )
  } catch {
    // Serialization failure on concurrent request — treat as already used
    return { ok: false, reason: 'already_used' }
  }
}
