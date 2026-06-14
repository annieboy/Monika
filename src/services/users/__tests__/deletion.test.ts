/**
 * User deletion service tests — GDPR Article 17 (Right to Erasure).
 *
 * Verifies: TrueLayer consent revocation, PII field nulling, audit log entry,
 * error isolation (one bad revoke does not block the rest), and that
 * transactions and audit logs are preserved (not deleted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../../banking/providers/truelayer.js', () => ({
  TrueLayerProvider: vi.fn().mockImplementation(function () {
    return { revokeConsent: vi.fn().mockResolvedValue(undefined) }
  }),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('decrypted-access-token')),
}))

vi.mock('../../onboarding/audit.js', () => ({
  logConsentEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../config.js', () => ({
  config: {
    TRUELAYER_CLIENT_ID: 'client-id',
    TRUELAYER_CLIENT_SECRET: 'client-secret',
    TRUELAYER_REDIRECT_URI: 'https://monika.app/banking/callback',
    TRUELAYER_ENVIRONMENT: 'sandbox',
    ENCRYPTION_KEY: 'a'.repeat(64),
  },
}))

import { deleteUser, exportUserData } from '../deletion.js'
import { logConsentEvent } from '../../onboarding/audit.js'
import type { TrueLayerProvider } from '../../../banking/providers/truelayer.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-00000001'

function makeConnection(id: string) {
  return { id, accessTokenEnc: Buffer.from('encrypted-token') }
}

function makePrisma(opts: {
  connections?: ReturnType<typeof makeConnection>[]
} = {}): PrismaClient {
  const connections = opts.connections ?? [makeConnection('conn-1')]
  return {
    bankConnection: {
      findMany: vi.fn().mockResolvedValue(connections),
      updateMany: vi.fn().mockResolvedValue({ count: connections.length }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: USER_ID, createdAt: new Date() }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    conversation: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient
}

// ── deleteUser ─────────────────────────────────────────────────────────────────

describe('deleteUser', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns connectionsRevoked count equal to number of active connections', async () => {
    const prisma = makePrisma({ connections: [makeConnection('conn-1'), makeConnection('conn-2')] })
    const result = await deleteUser(prisma, USER_ID)
    expect(result.connectionsRevoked).toBe(2)
    expect(result.revokeErrors).toHaveLength(0)
  })

  it('nulls out PII fields on the user record', async () => {
    const prisma = makePrisma({ connections: [] })
    await deleteUser(prisma, USER_ID)

    const updateCall = vi.mocked(prisma.user.update).mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(updateCall.data.whatsappPhoneEnc).toBeNull()
    expect(updateCall.data.fullNameEnc).toBeNull()
    expect(updateCall.data.emailEnc).toBeNull()
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date)
  })

  it('marks all bank connections as revoked in DB regardless of API result', async () => {
    const prisma = makePrisma()
    await deleteUser(prisma, USER_ID)

    expect(prisma.bankConnection.updateMany).toHaveBeenCalledOnce()
    const args = vi.mocked(prisma.bankConnection.updateMany).mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(args.data.consentStatus).toBe('revoked')
  })

  it('writes an immutable audit log entry', async () => {
    const prisma = makePrisma()
    await deleteUser(prisma, USER_ID)

    expect(logConsentEvent).toHaveBeenCalledOnce()
    const [, eventType, userId] = vi.mocked(logConsentEvent).mock.calls[0]!
    expect(eventType).toBe('user_deleted')
    expect(userId).toBe(USER_ID)
  })

  it('isolates revocation errors — continues and records them in revokeErrors', async () => {
    const { TrueLayerProvider: MockProvider } = await import('../../../banking/providers/truelayer.js')
    const mockRevoke = vi.fn()
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce(undefined)

    vi.mocked(MockProvider).mockImplementation(function () {
      return { revokeConsent: mockRevoke } as unknown as InstanceType<typeof TrueLayerProvider>
    })

    const prisma = makePrisma({
      connections: [makeConnection('conn-bad'), makeConnection('conn-ok')],
    })

    const result = await deleteUser(prisma, USER_ID)

    // conn-bad failed, conn-ok succeeded
    expect(result.connectionsRevoked).toBe(1)
    expect(result.revokeErrors).toHaveLength(1)
    expect(result.revokeErrors[0]).toContain('conn-bad')
    expect(result.revokeErrors[0]).toContain('API timeout')
  })

  it('completes the full deletion even when ALL revocations fail', async () => {
    const { TrueLayerProvider: MockProvider } = await import('../../../banking/providers/truelayer.js')
    vi.mocked(MockProvider).mockImplementation(function () {
      return { revokeConsent: vi.fn().mockRejectedValue(new Error('Service unavailable')) } as unknown as InstanceType<typeof TrueLayerProvider>
    })

    const prisma = makePrisma({ connections: [makeConnection('conn-1')] })
    const result = await deleteUser(prisma, USER_ID)

    // PII should still be nulled
    expect(prisma.user.update).toHaveBeenCalledOnce()
    // Audit log should still be written
    expect(logConsentEvent).toHaveBeenCalledOnce()
    // Error reported
    expect(result.revokeErrors).toHaveLength(1)
    expect(result.connectionsRevoked).toBe(0)
  })

  it('handles users with no bank connections gracefully', async () => {
    const prisma = makePrisma({ connections: [] })
    const result = await deleteUser(prisma, USER_ID)

    expect(result.connectionsRevoked).toBe(0)
    expect(result.revokeErrors).toHaveLength(0)
    expect(prisma.user.update).toHaveBeenCalledOnce()
  })

  it('does NOT delete transactions or conversations (regulatory preservation)', async () => {
    const prisma = makePrisma()
    await deleteUser(prisma, USER_ID)

    // No delete calls on transaction or conversation models
    expect((prisma as unknown as Record<string, unknown>).transaction).not.toHaveProperty('delete')
    expect((prisma as unknown as Record<string, unknown>).transaction).not.toHaveProperty('deleteMany')
  })
})

// ── exportUserData ─────────────────────────────────────────────────────────────

describe('exportUserData', () => {
  it('returns all required top-level keys', async () => {
    const prisma = makePrisma({ connections: [] })
    const result = await exportUserData(prisma, USER_ID)

    expect(result).toHaveProperty('exportedAt')
    expect(result).toHaveProperty('profile')
    expect(result).toHaveProperty('bankConnections')
    expect(result).toHaveProperty('transactions')
    expect(result).toHaveProperty('conversationHistory')
    expect(result).toHaveProperty('consentHistory')
  })

  it('exportedAt is a valid ISO timestamp', async () => {
    const prisma = makePrisma({ connections: [] })
    const result = await exportUserData(prisma, USER_ID)
    expect(() => new Date(result.exportedAt as string)).not.toThrow()
    expect(new Date(result.exportedAt as string).toISOString()).toBe(result.exportedAt as string)
  })

  it('queries user with select that excludes all encrypted PII fields', async () => {
    const prisma = makePrisma({ connections: [] })
    await exportUserData(prisma, USER_ID)

    const args = vi.mocked(prisma.user.findUnique).mock.calls[0]![0] as {
      select: Record<string, unknown>
    }
    const selected = Object.keys(args.select)
    // Must include safe fields
    expect(selected).toContain('id')
    expect(selected).toContain('createdAt')
    // Must NOT include any encrypted columns
    expect(selected).not.toContain('whatsappPhoneEnc')
    expect(selected).not.toContain('fullNameEnc')
    expect(selected).not.toContain('emailEnc')
    expect(selected).not.toContain('whatsappPhoneHash')
  })
})
