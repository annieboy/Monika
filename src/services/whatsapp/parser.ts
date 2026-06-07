import type {
  WhatsAppWebhookPayload,
  WhatsAppTextMessage,
  ParsedTextMessage,
} from '../../types/whatsapp.js'

function isTextMessage(msg: { type: string }): msg is WhatsAppTextMessage {
  return msg.type === 'text'
}

/**
 * Extracts the first text message from a WhatsApp webhook payload.
 * Returns null if the payload contains no text messages (e.g. status updates,
 * media messages, delivery receipts).
 */
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
