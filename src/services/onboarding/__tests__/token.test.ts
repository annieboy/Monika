/**
 * Onboarding token tests — auth boundary for the bank-connect flow.
 *
 * generateOnboardingToken: 256-bit hex, stored with 15-min TTL.
 * validateAndConsumeToken: all rejection reasons, happy path,
 *   atomic consume (update called exactly once), serialization failure
 *   treated as already_used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { generateOnboardingToken, validateAndConsumeToken } from '../token.js'

// ── generateOnboardingToken ───────────────────────────────────────────────────

function makePrismaCreate(): PrismaClient {
  return {
    onboardingToken: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('generateOnboardingToken', () => {
  it('returns a 64-character hex string (256-bit token)', async () => {
    const prisma = makePrismaCreate()
    const token = await generateOnboardingToken(prisma, 'user-1')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates a different token on every call (crypto random)', async () => {
    const prisma = makePrismaCreate()
    const t1 = await generateOnboardingToken(prisma, 'user-1')
    const t2 = await generateOnboardingToken(prisma, 'user-1')
    expect(t1).not.toBe(t2)
  })

  it('stores the token in the DB with purpose bank_connect', async () => {
    const prisma = makePrismaCreate()
    const token = await generateOnboardingToken(prisma, 'user-42')

    expect(prisma.onboardingToken.create).toHaveBeenCalledOnce()
    const data = (vi.mocked(prisma.onboardingToken.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.token).toBe(token)
    expect(data.userId).toBe('user-42')
    expect(data.purpose).toBe('bank_connect')
  })

  it('sets expiresAt to ~15 minutes in the future', async () => {
    const prisma = makePrismaCreate()
    const before = Date.now()
    await generateOnboardingToken(prisma, 'user-1')
    const after = Date.now()

    const data = (vi.mocked(prisma.onboardingToken.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    const expiresAt = (data.expiresAt as Date).getTime()
    const expectedMin = before + 14 * 60 * 1000
    const expectedMax = after + 16 * 60 * 1000
    expect(expiresAt).toBeGreaterThan(expectedMin)
    expect(expiresAt).toBeLessThan(expectedMax)
  })
})

// ── validateAndConsumeToken ───────────────────────────────────────────────────

function makePrismaValidate(record: Record<string, unknown> | null): PrismaClient {
  const txFn = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      onboardingToken: {
        findUnique: vi.fn().mockResolvedValue(record),
        update: vi.fn().mockResolvedValue({}),
      },
    }
    return fn(tx)
  })

  return {
    $transaction: txFn,
  } as unknown as PrismaClient
}

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-99',
    purpose: 'bank_connect',
    usedAt: null,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min from now
    ...overrides,
  }
}

describe('validateAndConsumeToken', () => {
  it('returns ok:true and userId for a valid unused token', async () => {
    const prisma = makePrismaValidate(validRecord())
    const result = await validateAndConsumeToken(prisma, 'abc123')
    expect(result).toEqual({ ok: true, userId: 'user-99' })
  })

  it('marks the token as used (updates usedAt) on success', async () => {
    const prisma = makePrismaValidate(validRecord())
    await validateAndConsumeToken(prisma, 'abc123')

    const txFn = vi.mocked(prisma.$transaction)
    // Reconstruct the tx object that was passed to the transaction callback
    const txArg = txFn.mock.calls[0]![0] as unknown as (tx: { onboardingToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } }) => Promise<unknown>
    // Invoke again to inspect update call
    const fakeUpdate = vi.fn().mockResolvedValue({})
    const fakeFindUnique = vi.fn().mockResolvedValue(validRecord())
    await txArg({ onboardingToken: { findUnique: fakeFindUnique, update: fakeUpdate } })
    expect(fakeUpdate).toHaveBeenCalledOnce()
    const updateData = (fakeUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(updateData.usedAt).toBeInstanceOf(Date)
  })

  it('returns not_found when token does not exist', async () => {
    const prisma = makePrismaValidate(null)
    const result = await validateAndConsumeToken(prisma, 'nonexistent')
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns wrong_purpose for a token with a different purpose', async () => {
    const prisma = makePrismaValidate(validRecord({ purpose: 'password_reset' }))
    const result = await validateAndConsumeToken(prisma, 'abc123')
    expect(result).toEqual({ ok: false, reason: 'wrong_purpose' })
  })

  it('returns already_used when usedAt is set', async () => {
    const prisma = makePrismaValidate(validRecord({ usedAt: new Date() }))
    const result = await validateAndConsumeToken(prisma, 'abc123')
    expect(result).toEqual({ ok: false, reason: 'already_used' })
  })

  it('returns expired when expiresAt is in the past', async () => {
    const prisma = makePrismaValidate(validRecord({ expiresAt: new Date(Date.now() - 1000) }))
    const result = await validateAndConsumeToken(prisma, 'abc123')
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns already_used when $transaction throws (serialization failure)', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error('serialization failure')),
    } as unknown as PrismaClient

    const result = await validateAndConsumeToken(prisma, 'abc123')
    expect(result).toEqual({ ok: false, reason: 'already_used' })
  })

  it('never throws — always returns a result object', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error('DB down')),
    } as unknown as PrismaClient

    await expect(validateAndConsumeToken(prisma, 'any')).resolves.toBeDefined()
  })
})
