import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { hashPhoneNumber } from '../../lib/crypto.js'

export interface ProcessedMessage {
  userId: string
  conversationId: string
  isNewUser: boolean
}

/**
 * Processes a verified inbound WhatsApp text message:
 * 1. Upserts the User record by phone hash (phone never stored in plaintext)
 * 2. Skips duplicate messages (idempotent on waMessageId)
 * 3. Creates a Conversation record for the inbound message
 */
export async function processInboundMessage(
  prisma: PrismaClient,
  waMessageId: string,
  phone: string,
  text: string,
  wabaId: string,
): Promise<ProcessedMessage | null> {
  const phoneHash = hashPhoneNumber(phone)

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
      // keep wabaId current in case the user links a different WABA
      whatsappWabaId: wabaId,
    },
    select: { id: true, createdAt: true, updatedAt: true },
  })

  const isNewUser = user.createdAt.getTime() === user.updatedAt.getTime()

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      sessionId: randomUUID(),
      role: 'user',
      content: text,
      waMessageId,
    },
    select: { id: true },
  })

  return {
    userId: user.id,
    conversationId: conversation.id,
    isNewUser,
  }
}
