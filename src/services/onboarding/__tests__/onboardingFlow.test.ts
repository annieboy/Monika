import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleOnboardingStep,
  PROMPT_NAME,
  PROMPT_MARKETING,
  PROMPT_TERMS_DECLINED,
  TERMS_VERSION,
} from '../onboardingFlow.js'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../config.js', () => ({
  config: {
    APP_BASE_URL: 'https://monika.test',
    ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

vi.mock('../../../lib/crypto.js', () => ({
  encrypt: (buf: Buffer) => buf,       // identity for tests
  decrypt: (buf: Buffer) => buf,       // identity for tests
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<{
  fullNameEnc: Buffer | null
  termsAcceptedAt: Date | null
  gdprConsentAt: Date | null
}> = {}) {
  return {
    fullNameEnc: null,
    termsAcceptedAt: null,
    gdprConsentAt: null,
    ...overrides,
  }
}

function makePrisma(user: ReturnType<typeof makeUser>, priorOnboardingCount = 0) {
  return {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
    },
    conversation: {
      count: vi.fn().mockResolvedValue(priorOnboardingCount),
    },
  } as unknown as import('@prisma/client').PrismaClient
}

const USER_ID = 'user-123'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleOnboardingStep', () => {
  describe('Step 1 — name capture', () => {
    it('shows the welcome/name prompt on first ever message (no prior onboarding rows)', async () => {
      const prisma = makePrisma(makeUser(), 0)
      const result = await handleOnboardingStep(prisma, USER_ID, 'hello')
      expect(result.handled).toBe(true)
      expect(result.response).toBe(PROMPT_NAME)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('rejects a name that is too short (after prompt was shown)', async () => {
      const prisma = makePrisma(makeUser(), 1)
      const result = await handleOnboardingStep(prisma, USER_ID, 'A')
      expect(result.handled).toBe(true)
      expect(result.response).toMatch(/2.64 characters/)
    })

    it('saves the first name and returns the terms prompt (after prompt was shown)', async () => {
      const prisma = makePrisma(makeUser(), 1)
      const result = await handleOnboardingStep(prisma, USER_ID, 'Annie')
      expect(result.handled).toBe(true)
      expect(result.response).toMatch(/Annie/)
      expect(result.response).toMatch(/Terms/)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fullNameEnc: expect.anything() }) }),
      )
    })

    it('uses only the first word of a multi-word reply', async () => {
      const prisma = makePrisma(makeUser(), 1)
      await handleOnboardingStep(prisma, USER_ID, 'Annie Smith')
      const updateCall = (prisma.user.update as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      // encrypt(Buffer.from('Annie')) → Buffer.from('Annie') in test
      expect(Buffer.from(updateCall.data.fullNameEnc).toString()).toBe('Annie')
    })
  })

  describe('Step 2 — terms acceptance', () => {
    const nameEnc = Buffer.from('Annie')
    // conversation.count only called in step 1; steps 2+ short-circuit before it

    it('re-prompts if reply is not yes/no', async () => {
      const prisma = makePrisma(makeUser({ fullNameEnc: nameEnc }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'what terms?')
      expect(result.handled).toBe(true)
      expect(result.response).toMatch(/Terms/)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('returns declined message when user says no', async () => {
      const prisma = makePrisma(makeUser({ fullNameEnc: nameEnc }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'no')
      expect(result.handled).toBe(true)
      expect(result.response).toBe(PROMPT_TERMS_DECLINED)
    })

    it('saves acceptance and returns marketing prompt on YES', async () => {
      const prisma = makePrisma(makeUser({ fullNameEnc: nameEnc }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'YES')
      expect(result.handled).toBe(true)
      expect(result.response).toBe(PROMPT_MARKETING)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            termsAcceptedAt: expect.any(Date),
            termsVersion: TERMS_VERSION,
          }),
        }),
      )
    })

    it('accepts lowercase yes', async () => {
      const prisma = makePrisma(makeUser({ fullNameEnc: nameEnc }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'yes')
      expect(result.handled).toBe(true)
      expect(result.response).toBe(PROMPT_MARKETING)
    })
  })

  describe('Step 3 — marketing consent', () => {
    const nameEnc = Buffer.from('Annie')
    const termsAcceptedAt = new Date('2024-01-01')

    it('re-prompts if reply is not yes/no', async () => {
      const prisma = makePrisma(makeUser({ fullNameEnc: nameEnc, termsAcceptedAt }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'maybe')
      expect(result.handled).toBe(true)
      expect(result.response).toBe(PROMPT_MARKETING)
    })

    it('saves consent=true and returns welcome message on YES', async () => {
      const prisma = makePrisma(makeUser({ fullNameEnc: nameEnc, termsAcceptedAt }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'yes')
      expect(result.handled).toBe(true)
      expect(result.response).toMatch(/Welcome aboard/)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gdprConsentAt: expect.any(Date), marketingConsent: true }),
        }),
      )
    })

    it('saves consent=false and returns welcome message on NO', async () => {
      const prisma = makePrisma(makeUser({ fullNameEnc: nameEnc, termsAcceptedAt }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'no')
      expect(result.handled).toBe(true)
      expect(result.response).toMatch(/Welcome aboard/)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ marketingConsent: false }),
        }),
      )
    })
  })

  describe('Onboarding complete', () => {
    it('returns handled=false when all fields are set', async () => {
      const prisma = makePrisma(makeUser({
        fullNameEnc: Buffer.from('Annie'),
        termsAcceptedAt: new Date(),
        gdprConsentAt: new Date(),
      }))
      const result = await handleOnboardingStep(prisma, USER_ID, 'what is my balance?')
      expect(result.handled).toBe(false)
    })
  })
})
