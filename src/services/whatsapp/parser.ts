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

/**
 * The words a message carries, whichever way the user sent them: typed text,
 * a tap on one of our reply buttons / list rows, or a tap on a template
 * quick-reply. A button tap is treated exactly like typing its label, so
 * "My balance" as a button behaves the same as the typed question.
 * Returns null for anything with no usable text (media, reactions, …).
 */
function extractMessageText(msg: { type: string }): string | null {
  if (isTextMessage(msg)) return msg.text.body

  const raw = msg as unknown as Record<string, unknown>
  let label: unknown
  if (msg.type === 'interactive') {
    const interactive = raw['interactive'] as Record<string, { title?: unknown } | undefined> | undefined
    label = interactive?.['button_reply']?.title ?? interactive?.['list_reply']?.title
  } else if (msg.type === 'button') {
    label = (raw['button'] as { text?: unknown } | undefined)?.text
  }
  return typeof label === 'string' && label.trim().length > 0 ? label : null
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

/**
 * Extracts the first message with usable text from a WhatsApp webhook payload:
 * a typed message or a button/list tap. Returns null if there is none (e.g.
 * status updates, media messages, delivery receipts).
 */
export function parseTextMessage(
  payload: WhatsAppWebhookPayload,
): ParsedTextMessage | null {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue
      const messages = change.value.messages ?? []
      for (const msg of messages) {
        const text = extractMessageText(msg)
        if (text === null) continue
        return {
          waMessageId: msg.id,
          from: msg.from,
          text,
          timestamp: new Date(Number(msg.timestamp) * 1000),
        }
      }
    }
  }
  return null
}
