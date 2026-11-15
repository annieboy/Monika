/** Meta WhatsApp Cloud API inbound webhook payload types */

export interface WhatsAppTextMessage {
  id: string
  from: string
  timestamp: string
  type: 'text'
  text: {
    body: string
  }
}

export interface WhatsAppNonTextMessage {
  id: string
  from: string
  timestamp: string
  type: Exclude<string, 'text'>
}

/** A tap on a reply button / list row of an interactive message we sent. */
export interface WhatsAppInteractiveMessage {
  id: string
  from: string
  timestamp: string
  type: 'interactive'
  interactive:
    | { type: 'button_reply'; button_reply: { id: string; title: string } }
    | { type: 'list_reply'; list_reply: { id: string; title: string; description?: string } }
}

/** A tap on a quick-reply button of a template message. */
export interface WhatsAppTemplateButtonMessage {
  id: string
  from: string
  timestamp: string
  type: 'button'
  button: { text: string; payload?: string }
}

export type WhatsAppMessage = WhatsAppTextMessage | WhatsAppNonTextMessage

export interface WhatsAppWebhookValue {
  messaging_product: 'whatsapp'
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: Array<{
    profile: { name: string }
    wa_id: string
  }>
  messages?: WhatsAppMessage[]
  statuses?: unknown[]
  errors?: unknown[]
  [key: string]: unknown
}

export interface WhatsAppWebhookChange {
  value: WhatsAppWebhookValue
  field: string
}

export interface WhatsAppWebhookEntry {
  id: string
  changes: WhatsAppWebhookChange[]
}

export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account'
  entry: WhatsAppWebhookEntry[]
}

export interface ParsedTextMessage {
  waMessageId: string
  from: string
  text: string
  timestamp: Date
}

// ── Status update types ────────────────────────────────────────────────────

export type WhatsAppStatusValue = 'sent' | 'delivered' | 'read' | 'failed'

export interface WhatsAppStatusError {
  code: number
  title: string
  message?: string
  error_data?: { details: string }
}

export interface WhatsAppStatusUpdate {
  id: string              // wamid of the outbound message
  status: WhatsAppStatusValue
  timestamp: string       // unix seconds
  recipient_id: string    // E.164 phone
  errors?: WhatsAppStatusError[]
}

export interface ParsedStatusUpdate {
  waMessageId: string
  status: WhatsAppStatusValue
  timestamp: Date
  recipientPhone: string
  errorCode?: number
  errorTitle?: string
}
