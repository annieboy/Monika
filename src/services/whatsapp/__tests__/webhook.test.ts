/**
 * processInboundMessage tests — the core WhatsApp message orchestrator.
 *
 * Verified paths:
 *   - Deduplication: returns null when waMessageId already exists
 *   - New-user detection: isNewUser flag based on createdAt/updatedAt equality
 *   - Opportunity reply short-circuit: intent = 'opportunity_reply', no classifier
 *   - Consent prompt appended for first-time users (no prefs row)
 *   - Consent prompt NOT appended when prefs already exist
 *   - Conversation rows persisted for both user and assistant turns
 *   - trackEvent fired for signup on new user
 *   - trackEvent fired for question_answered on data intents
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../../lib/crypto.js', () => ({
  hashPhoneNumber: vi.fn().mockReturnValue('hashed-phone'),
  encrypt: vi.fn().mockReturnValue(Buffer.from('encrypted-phone')),
}))

vi.mock('../../agent/classifier.js', () => ({
  classifyIntent: vi.fn().mockResolvedValue({
    intent: 'account_balance',
    confidence: 'high',
    method: 'rules',
  }),
}))

vi.mock('../../agent/router.js', () => ({
  routeIntent: vi.fn().mockResolvedValue('You have £1,234 in your account.'),
}))

vi.mock('../../analytics/events.js', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
  hasAskedBefore: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../conversation/opportunityConversationHandler.js', () => ({
  handleOpportunityReply: vi.fn().mockResolvedValue({ handled: false, response: '' }),
}))

vi.mock('../../conversation/sessionService.js', () => ({
  getOrCreateSession: vi.fn().mockResolvedValue('session-abc'),
  loadSessionHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../opportunity/opportunityMessageBuilder.js', () => ({
  CONSENT_PROMPT: 'Would you like personalised offers?',
}))

vi.mock('../../../config.js', () => ({
  config: {
    SECRET_KEY: 'secret-key',
    ENCRYPTION_KEY: 'a'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test',
  },
}))

import { processInboundMessage } from '../webhook.js'
import { trackEvent } from '../../analytics/events.js'
import { handleOpportunityReply } from '../../conversation/opportunityConversationHandler.js'
import { classifyIntent } from '../../agent/classifier.js'

const WABA_ID = 'waba-001'
const PHONE = '447700900001'
const MSG_ID = 'wamid.abc123'

function makeUser(isNew: boolean) {
  const ts = new Date('2024-06-01T10:00:00Z')
  return {
    id: 'user-001',
    createdAt: ts,
    updatedAt: isNew ? ts : new Date('2024-06-10T10:00:00Z'),
  }
}

function makePrisma(opts: {
  existingConversation?: { id: string; userId: string } | null
  isNewUser?: boolean
  hasPrefs?: boolean
} = {}): PrismaClient {
  const conversationCreateCalls: unknown[] = []
  let callCount = 0

  return {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(opts.existingConversation ?? null),
      create: vi.fn().mockImplementation(() => {
        callCount++
        const id = `conv-${callCount}`
        conversationCreateCalls.push(id)
        return Promise.resolve({ id })
      }),
    },
    user: {
      upsert: vi.fn().mockResolvedValue(makeUser(opts.isNewUser ?? false)),
    },
    userOpportunityPreferences: {
      findUnique: vi.fn().mockResolvedValue(opts.hasPrefs ? { userId: 'user-001' } : null),
    },
  } as unknown as PrismaClient
}

describe('processInboundMessage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when the waMessageId already exists (deduplication)', async () => {
    const prisma = makePrisma({ existingConversation: { id: 'conv-existing', userId: 'user-001' } })
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'hello', WABA_ID)
    expect(result).toBeNull()
  })

  it('returns a ProcessedMessage on the happy path', async () => {
    const prisma = makePrisma()
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'what is my balance?', WABA_ID)
    expect(result).not.toBeNull()
    expect(result?.userId).toBe('user-001')
    expect(result?.sessionId).toBe('session-abc')
  })

  it('marks isNewUser true when createdAt equals updatedAt', async () => {
    const prisma = makePrisma({ isNewUser: true })
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'hi', WABA_ID)
    expect(result?.isNewUser).toBe(true)
  })

  it('marks isNewUser false when updatedAt is later than createdAt', async () => {
    const prisma = makePrisma({ isNewUser: false })
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'hi', WABA_ID)
    expect(result?.isNewUser).toBe(false)
  })

  it('fires trackEvent("signup") for a new user', async () => {
    const prisma = makePrisma({ isNewUser: true })
    await processInboundMessage(prisma, MSG_ID, PHONE, 'hello', WABA_ID)
    expect(trackEvent).toHaveBeenCalledWith(expect.anything(), 'signup', 'user-001', expect.any(Object))
  })

  it('does not fire trackEvent("signup") for an existing user', async () => {
    const prisma = makePrisma({ isNewUser: false })
    await processInboundMessage(prisma, MSG_ID, PHONE, 'hello', WABA_ID)
    const signupCalls = vi.mocked(trackEvent).mock.calls.filter(([, evt]) => evt === 'signup')
    expect(signupCalls).toHaveLength(0)
  })

  it('short-circuits with opportunity_reply intent when opportunityHandler handles the message', async () => {
    vi.mocked(handleOpportunityReply).mockResolvedValueOnce({
      handled: true,
      response: 'Thanks for your interest! Here is your link.',
    })
    const prisma = makePrisma()
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'yes please', WABA_ID)
    expect(result?.intent).toBe('opportunity_reply')
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it('appends CONSENT_PROMPT when user has no prefs row', async () => {
    const prisma = makePrisma({ hasPrefs: false })
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'balance?', WABA_ID)
    expect(result?.response).toContain('Would you like personalised offers?')
  })

  it('does NOT append CONSENT_PROMPT when prefs already exist', async () => {
    const prisma = makePrisma({ hasPrefs: true })
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'balance?', WABA_ID)
    expect(result?.response).not.toContain('Would you like personalised offers?')
  })

  it('creates two conversation rows — one user, one assistant', async () => {
    const prisma = makePrisma()
    await processInboundMessage(prisma, MSG_ID, PHONE, 'balance?', WABA_ID)
    expect(prisma.conversation.create).toHaveBeenCalledTimes(2)
  })

  it('returns the correct conversationId and responseConversationId', async () => {
    const prisma = makePrisma()
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'balance?', WABA_ID)
    expect(result?.conversationId).toBe('conv-1')
    expect(result?.responseConversationId).toBe('conv-2')
  })

  it('fires question_answered event for data intents', async () => {
    vi.mocked(classifyIntent).mockResolvedValueOnce({
      intent: 'account_balance',
      confidence: 'high',
      method: 'rules',
    })
    const prisma = makePrisma()
    await processInboundMessage(prisma, MSG_ID, PHONE, 'balance?', WABA_ID)
    const answeredCalls = vi.mocked(trackEvent).mock.calls.filter(([, evt]) => evt === 'question_answered')
    expect(answeredCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('returns the classified intent in the result', async () => {
    vi.mocked(classifyIntent).mockResolvedValueOnce({
      intent: 'savings_query',
      confidence: 'high',
      method: 'llm',
    })
    const prisma = makePrisma()
    const result = await processInboundMessage(prisma, MSG_ID, PHONE, 'how much am I saving?', WABA_ID)
    expect(result?.intent).toBe('savings_query')
  })
})
