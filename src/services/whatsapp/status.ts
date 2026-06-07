/**
 * Processes inbound WhatsApp delivery/read status updates.
 *
 * When Meta delivers a status callback (sent → delivered → read, or failed),
 * we update the wa_status field on the matching outbound Conversation row so
 * the admin dashboard can show delivery state alongside conversation history.
 *
 * Status progression: sent → delivered → read (or failed at any point).
 * We only advance status, never regress (delivered cannot go back to sent).
 */

import type { PrismaClient } from '@prisma/client'
import type { ParsedStatusUpdate } from '../../types/whatsapp.js'

const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
}

export async function processStatusUpdate(
  prisma: PrismaClient,
  update: ParsedStatusUpdate,
): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { waMessageId: update.waMessageId },
    select: { id: true, waStatus: true },
  })

  if (!conversation) return  // status for a message we don't track — ignore

  const currentRank = STATUS_RANK[conversation.waStatus ?? ''] ?? 0
  const incomingRank = STATUS_RANK[update.status] ?? 0

  // Only advance status — never regress
  if (incomingRank <= currentRank) return

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { waStatus: update.status },
  })
}
