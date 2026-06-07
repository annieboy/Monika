import type {
  WhatsAppWebhookPayload,
  WhatsAppTextMessage,
  ParsedTextMessage,
  WhatsAppStatusUpdate,
  ParsedStatusUpdate,
} from '../../types/whatsapp.js'

function isTextMessage(msg: { type: string }): msg is WhatsAppTextMessage {
  return msg.type === 'text'
}

function isStatusUpdate(obj: unknown): obj is WhatsAppStatusUpdate {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return (
    typeof o['id'] === 'string' &&
    typeof o['status'] === 'string' &&
    typeof o['timestamp'] === 'string' &&
    typeof o['recipient_id'] === 'string'
  )
}

/**
 * Extracts the first text message from a WhatsApp webhook payload.
 * Returns null if the payload contains no text messages (e.g. status updates,
 * media messages, delivery receipts).
 */
/**
 * Extracts all delivery/read status updates from a WhatsApp webhook payload.
 * Meta sends these when an outbound message changes state (sent → delivered → read).
 */
export function parseStatusUpdates(payload: WhatsAppWebhookPayload): ParsedStatusUpdate[] {
  const results: ParsedStatusUpdate[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue
      const statuses = change.value.statuses ?? []
      for (const raw of statuses) {
        if (!isStatusUpdate(raw)) continue
        const firstError = raw.errors?.[0]
        results.push({
          waMessageId: raw.id,
          status: raw.status as ParsedStatusUpdate['status'],
          timestamp: new Date(Number(raw.timestamp) * 1000),
          recipientPhone: raw.recipient_id,
          ...(firstError ? { errorCode: firstError.code, errorTitle: firstError.title } : {}),
        })
      }
    }
  }

  return results
}

export function parseTextMessage(
  payload: WhatsAppWebhookPayload,
): ParsedTextMessage | null {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue
      const messages = change.value.messages ?? []
      for (const msg of messages) {
        if (!isTextMessage(msg)) continue
        return {
          waMessageId: msg.id,
          from: msg.from,
          text: msg.text.body,
          timestamp: new Date(Number(msg.timestamp) * 1000),
        }
      }
    }
  }
  return null
}
