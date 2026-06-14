/**
 * Tests for the consent prompt injection in processInboundMessage.
 *
 * A new user (no UserOpportunityPreferences) should receive the CONSENT_PROMPT
 * appended to their first response. A returning user (prefs exist) should not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { CONSENT_PROMPT } from '../../opportunity/opportunityMessageBuilder.js'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../agent/classifier.js', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'general_question', confidence: 0.9, method: 'rules' }),
}))

vi.mock('../../agent/router.js', () => ({
  routeIntent: vi.fn().mockResolvedValue('Here is your answer.'),
}))

vi.mock('../../analytics/events.js', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
  hasAskedBefore: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../conversation/opportunityConversationHandler.js', () => ({
  handleOpportunityReply: vi.fn().mockResolvedValue({ handled: false, response: '' }),
}))

vi.mock('../../onboarding/onboardingFlow.js', () => ({
  handleOnboardingStep: vi.fn().mockResolvedValue({ handled: false, response: '' }),
}))

vi.mock('../../conversation/sessionService.js', () => ({
  getOrCreateSession: vi.fn().mockResolvedValue('session-uuid'),
  loadSessionHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../lib/crypto.js', () => ({
  hashPhoneNumber: vi.fn().mockReturnValue('a'.repeat(64)),
  encrypt: vi.fn().mockReturnValue(Buffer.from('encrypted')),
}))

import { processInboundMessage } from '../webhook.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date()
const NEW_USER = { id: 'user-1', createdAt: NOW, updatedAt: NOW }
const _RETURNING_USER = { id: 'user-2', createdAt: new Date(NOW.getTime() - 1000), updatedAt: NOW }

function makePrisma(opts: {
  hasPrefs?: boolean
  user?: typeof NEW_USER
  existingMessage?: boolean
} = {}): PrismaClient {
  const user = opts.user ?? NEW_USER
  return {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(opts.existingMessage ? { id: 'dup', userId: user.id } : null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'conv-1' }),
    },
    user: {
      upsert: vi.fn().mockResolvedValue(user),
    },
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(opts.hasPrefs ? { opportunitiesConsent: true } : null),
    },
  } as unknown as PrismaClient
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processInboundMessage — consent prompt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appends CONSENT_PROMPT for a user with no preferences', async () => {
    const prisma = makePrisma({ hasPrefs: false })
    const result = await processInboundMessage(prisma, 'wamid-1', '447700900001', 'Hello', 'waba-1')

    expect(result).not.toBeNull()
    expect(result!.response).toContain('Here is your answer.')
    expect(result!.response).toContain(CONSENT_PROMPT)
  })

  it('does NOT append CONSENT_PROMPT when prefs already exist', async () => {
    const prisma = makePrisma({ hasPrefs: true })
    const result = await processInboundMessage(prisma, 'wamid-2', '447700900001', 'Hello', 'waba-1')

    expect(result).not.toBeNull()
    expect(result!.response).toBe('Here is your answer.')
    expect(result!.response).not.toContain('One quick thing')
  })

  it('returns null for a duplicate message without consent check', async () => {
    const prisma = makePrisma({ existingMessage: true })
    const result = await processInboundMessage(prisma, 'wamid-dup', '447700900001', 'Hello', 'waba-1')

    expect(result).toBeNull()
    expect(prisma.userOpportunityPreferences.findUnique).not.toHaveBeenCalled()
  })

  it('CONSENT_PROMPT contains YES and NO reply instructions', () => {
    expect(CONSENT_PROMPT).toContain('YES')
    expect(CONSENT_PROMPT).toContain('NO')
    expect(CONSENT_PROMPT).toContain('STOP')
  })
})
