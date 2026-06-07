import { randomBytes } from 'crypto'
import type { PrismaClient } from '@prisma/client'

const TOKEN_TTL_MS = 15 * 60 * 1000  // 15 minutes — matches OnboardingToken schema comment

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
 * Validates a token and atomically marks it as used.
 * Returns the userId on success, or a typed failure reason.
 * After this call returns ok:true, the token cannot be used again.
 */
export async function validateAndConsumeToken(
  prisma: PrismaClient,
  token: string,
): Promise<TokenValidationResult> {
  const record = await prisma.onboardingToken.findUnique({
    where: { token },
    select: { userId: true, expiresAt: true, usedAt: true, purpose: true },
  })

  if (!record) return { ok: false, reason: 'not_found' }
  if (record.purpose !== 'bank_connect') return { ok: false, reason: 'wrong_purpose' }
  if (record.usedAt !== null) return { ok: false, reason: 'already_used' }
  if (record.expiresAt < new Date()) return { ok: false, reason: 'expired' }

  await prisma.onboardingToken.update({
    where: { token },
    data: { usedAt: new Date() },
  })

  return { ok: true, userId: record.userId }
}
