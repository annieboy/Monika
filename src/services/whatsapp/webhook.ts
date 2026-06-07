import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { hashPhoneNumber } from '../../lib/crypto.js'
import { classifyIntent } from '../agent/classifier.js'
import { routeIntent } from '../agent/router.js'
import { trackEvent, hasAskedBefore } from '../analytics/events.js'
import { config } from '../../config.js'

// Intents that count as a real "data question" (not onboarding/unknown)
const DATA_INTENTS = new Set([
  'spending_analysis',
  'subscription_detection',
  'unusual_spending',
  'account_balance',
  'affordability_question',
])

export interface ProcessedMessage {
  userId: string
  conversationId: string
  responseConversationId: string
  isNewUser: boolean
  intent: string
  response: string
}

/**
 * Processes a verified inbound WhatsApp text message:
 * 1. Deduplicates by waMessageId (Meta may redeliver)
 * 2. Upserts the User by phone hash (raw phone never stored)
 * 3. Stores the inbound message as a 'user' Conversation row
 * 4. Classifies the message intent (rules → LLM fallback)
 * 5. Stores the assistant reply as an 'assistant' Conversation row
 */
export async function processInboundMessage(
  prisma: PrismaClient,
  waMessageId: string,
  phone: string,
  text: string,
  wabaId: string,
): Promise<ProcessedMessage | null> {
  const phoneHash = hashPhoneNumber(phone, config.SECRET_KEY)

  // Deduplicate — Meta may deliver the same message more than once
  const existing = await prisma.conversation.findFirst({
    where: { waMessageId },
    select: { id: true, userId: true },
  })
  if (existing) return null

  // Upsert user — create on first message, touch updatedAt on repeat
  const user = await prisma.user.upsert({
    where: { whatsappPhoneHash: phoneHash },
    create: {
      whatsappPhoneHash: phoneHash,
      whatsappWabaId: wabaId,
    },
    update: {
      whatsappWabaId: wabaId,
    },
    select: { id: true, createdAt: true, updatedAt: true },
  })

  const isNewUser = user.createdAt.getTime() === user.updatedAt.getTime()

  if (isNewUser) {
    trackEvent(prisma, 'signup', user.id, { wabaId }).catch(() => undefined)
  }

  const sessionId = randomUUID()

  // Store inbound message
  const userConversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      sessionId,
      role: 'user',
      content: text,
      waMessageId,
    },
    select: { id: true },
  })

  // Classify and route — routeIntent queries live transaction data for data-driven intents
  const classification = await classifyIntent(text, config.ANTHROPIC_API_KEY)
  const isDataIntent = DATA_INTENTS.has(classification.intent)

  // Check first_question before we create the assistant row (so the count stays at 0 prior)
  const isFirstQuestion = isDataIntent ? !(await hasAskedBefore(prisma, user.id)) : false

  const response = await routeIntent(classification.intent, text, user.id, prisma, config.ANTHROPIC_API_KEY)

  // Track product analytics events (fire-and-forget)
  if (isDataIntent) {
    if (isFirstQuestion) {
      trackEvent(prisma, 'first_question', user.id, { intent: classification.intent }).catch(() => undefined)
    }
    trackEvent(prisma, 'question_answered', user.id, {
      intent: classification.intent,
      method: classification.method,
    }).catch(() => undefined)
  }

  // Store assistant reply in the same session, with intent in toolCalls metadata
  const assistantConversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      sessionId,
      role: 'assistant',
      content: response,
      modelUsed: classification.method === 'llm' ? 'claude-haiku-4-5-20251001' : 'rules',
      toolCalls: {
        intent: classification.intent,
        confidence: classification.confidence,
        method: classification.method,
      },
    },
    select: { id: true },
  })

  return {
    userId: user.id,
    conversationId: userConversation.id,
    responseConversationId: assistantConversation.id,
    isNewUser,
    intent: classification.intent,
    response,
  }
}
