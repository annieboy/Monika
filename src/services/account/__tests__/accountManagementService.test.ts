import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { handleAccountManagement } from '../accountManagementService.js'

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockImplementation((buf: Buffer) => buf),
  encrypt: vi.fn().mockImplementation((buf: Buffer) => buf),
}))

vi.mock('../../onboarding/audit.js', () => ({
  logConsentEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../config.js', () => ({
  config: { ENCRYPTION_KEY: '0'.repeat(64) },
}))

const USER_ID = 'user-001'

function makePrisma(opts: {
  name?: string | null
  marketingConsent?: boolean
  pendingDelete?: boolean
} = {}) {
  const { name = 'Annie', marketingConsent = true, pendingDelete = false } = opts
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        fullNameEnc: name ? Buffer.from(name) : null,
        marketingConsent,
        onboardingStatus: 'active',
        termsAcceptedAt: new Date('2024-01-01'),
        termsVersion: '1.0',
        gdprConsentAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(
        pendingDelete ? { id: 'log-1', createdAt: new Date() } : null,
      ),
      create: vi.fn().mockResolvedValue({}),
    },
    transaction: { count: vi.fn().mockResolvedValue(42) },
    savingsGoal: { count: vi.fn().mockResolvedValue(2) },
    conversation: { count: vi.fn().mockResolvedValue(15) },
  } as unknown as PrismaClient
}

describe('handleAccountManagement', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('marketing opt-out', () => {
    it('updates marketingConsent to false and confirms', async () => {
      const prisma = makePrisma()
      const result = await handleAccountManagement(prisma, USER_ID, 'stop sending me offers')
      expect(result).toMatch(/turned off/i)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { marketingConsent: false } }),
      )
    })

    it('handles "unsubscribe"', async () => {
      const prisma = makePrisma()
      const result = await handleAccountManagement(prisma, USER_ID, 'unsubscribe')
      expect(result).toMatch(/turned off/i)
    })
  })

  describe('account deletion', () => {
    it('sends a confirmation prompt on first delete request', async () => {
      const prisma = makePrisma({ pendingDelete: false })
      const result = await handleAccountManagement(prisma, USER_ID, 'delete my account')
      expect(result).toMatch(/CONFIRM DELETE/i)
      expect(result).toMatch(/Are you sure/i)
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: 'account_delete_requested' }) }),
      )
    })

    it('performs soft delete on CONFIRM DELETE with pending request', async () => {
      const prisma = makePrisma({ pendingDelete: true })
      const result = await handleAccountManagement(prisma, USER_ID, 'CONFIRM DELETE')
      expect(result).toMatch(/deleted/i)
      expect(result).toMatch(/GDPR/i)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date), onboardingStatus: 'deleted' }),
        }),
      )
    })

    it('rejects CONFIRM DELETE without a pending request', async () => {
      const prisma = makePrisma({ pendingDelete: false })
      const result = await handleAccountManagement(prisma, USER_ID, 'CONFIRM DELETE')
      expect(result).toMatch(/No pending deletion/i)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('data request', () => {
    it('returns a data summary with counts', async () => {
      const prisma = makePrisma()
      const result = await handleAccountManagement(prisma, USER_ID, 'what data do you hold on me?')
      expect(result).toMatch(/Your data summary/i)
      expect(result).toMatch(/Annie/)
      expect(result).toMatch(/42/)   // transaction count
      expect(result).toMatch(/2/)    // goal count
      expect(result).toMatch(/15/)   // conversation count
    })
  })

  describe('name update', () => {
    it('updates the name and confirms', async () => {
      const prisma = makePrisma()
      const result = await handleAccountManagement(prisma, USER_ID, 'change my name to Charlotte')
      expect(result).toMatch(/Charlotte/)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fullNameEnc: expect.anything() }) }),
      )
    })

    it('asks for a name when none extracted', async () => {
      const prisma = makePrisma()
      const result = await handleAccountManagement(prisma, USER_ID, 'change my name')
      expect(result).toMatch(/Change my name to/i)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('profile query fallback', () => {
    it('returns account summary for generic account query', async () => {
      const prisma = makePrisma()
      const result = await handleAccountManagement(prisma, USER_ID, "what's my name?")
      expect(result).toMatch(/Your account/i)
      expect(result).toMatch(/Annie/)
    })
  })
})
