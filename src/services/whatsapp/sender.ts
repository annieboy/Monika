/**
 * Outbound WhatsApp message sender.
 *
 * Sends text messages via the Meta Cloud API with exponential-backoff retry.
 * Retries on transient server errors (5xx) and network failures.
 * Throws SendError after all attempts are exhausted so callers can decide
 * whether to surface the failure or log-and-continue.
 */

const GRAPH_API_VERSION = 'v19.0'
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [0, 1_000, 2_000] as const

export class SendError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly attempt?: number,
  ) {
    super(message)
    this.name = 'SendError'
  }
}

export interface SendResult {
  waMessageId: string
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button'
  parameters: Array<{ type: 'text'; text: string } | { type: 'url'; url: string }>
  sub_type?: string
  index?: number
}

interface MetaSendResponse {
  messaging_product: string
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string }>
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sends a text message to a WhatsApp user.
 *
 * @param to            Recipient phone number in E.164 format (e.g. 447700900001)
 * @param text          Message body (≤ 4096 chars per WhatsApp limits)
 * @param phoneNumberId Meta WABA phone number ID (from WHATSAPP_PHONE_NUMBER_ID)
 * @param accessToken   Meta permanent access token (from WHATSAPP_ACCESS_TOKEN)
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text },
  })

  let lastError: SendError | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const delayMs = RETRY_DELAYS_MS[attempt] ?? 2_000
    if (delayMs > 0) await sleep(delayMs)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body,
      })
    } catch (err) {
      // Network-level failure — retry
      lastError = new SendError(
        `Network error on attempt ${attempt + 1}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        attempt + 1,
      )
      continue
    }

    if (response.ok) {
      const data = (await response.json()) as MetaSendResponse
      const wamid = data.messages[0]?.id
      if (!wamid) {
        throw new SendError('Meta API returned success but no message ID in response')
      }
      return { waMessageId: wamid }
    }

    // Read and truncate error body — avoid logging full Meta error responses
    // which may contain rate-limit details or internal identifiers.
    const rawError = await response.text()
    const safeError = rawError.slice(0, 200)

    // 4xx errors are not retryable (bad request, auth failure, etc.)
    if (response.status >= 400 && response.status < 500) {
      throw new SendError(
        `Meta API rejected message (${response.status})`,
        response.status,
        attempt + 1,
      )
    }

    // 5xx — retryable
    lastError = new SendError(
      `Meta API server error on attempt ${attempt + 1} (${response.status}): ${safeError}`,
      response.status,
      attempt + 1,
    )
  }

  throw lastError ?? new SendError('All send attempts exhausted')
}

/**
 * Sends a Meta-approved template message.
 *
 * Template messages bypass the 24-hour customer care window and can be sent
 * proactively. The template must be pre-approved in Meta Business Manager.
 *
 * @param to            Recipient phone number in E.164 format
 * @param templateName  Approved template name (e.g. "monika_opportunity_v1")
 * @param languageCode  BCP 47 language code (e.g. "en_GB")
 * @param components    Template components with variable substitutions
 * @param phoneNumberId Meta WABA phone number ID
 * @param accessToken   Meta permanent access token
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  components: TemplateComponent[],
  phoneNumberId: string,
  accessToken: string,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  })

  let lastError: SendError | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const delayMs = RETRY_DELAYS_MS[attempt] ?? 2_000
    if (delayMs > 0) await sleep(delayMs)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body,
      })
    } catch (err) {
      lastError = new SendError(
        `Network error on attempt ${attempt + 1}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        attempt + 1,
      )
      continue
    }

    if (response.ok) {
      const data = (await response.json()) as MetaSendResponse
      const wamid = data.messages[0]?.id
      if (!wamid) throw new SendError('Meta API returned success but no message ID in response')
      return { waMessageId: wamid }
    }

    const rawError = await response.text()
    const safeError = rawError.slice(0, 200)

    if (response.status >= 400 && response.status < 500) {
      throw new SendError(`Meta API rejected template (${response.status})`, response.status, attempt + 1)
    }

    lastError = new SendError(
      `Meta API server error on attempt ${attempt + 1} (${response.status}): ${safeError}`,
      response.status,
      attempt + 1,
    )
  }

  throw lastError ?? new SendError('All template send attempts exhausted')
}

// ── Interactive messages (reply buttons, link button) ─────────────────────────
// These are free-form messages: allowed inside the 24-hour customer-care window
// with no template approval, and they work on the Meta test number.

export interface ReplyButton {
  /** Opaque id echoed back by Meta when the button is tapped. */
  id: string
  /** Label shown on the button — WhatsApp allows at most 20 characters. */
  title: string
}

export const MAX_REPLY_BUTTONS = 3
export const MAX_BUTTON_TITLE_LENGTH = 20
export const MAX_INTERACTIVE_BODY_LENGTH = 1024

async function postInteractive(
  to: string,
  interactive: Record<string, unknown>,
  phoneNumberId: string,
  accessToken: string,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  })

  let lastError: SendError | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const delayMs = RETRY_DELAYS_MS[attempt] ?? 2_000
    if (delayMs > 0) await sleep(delayMs)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body,
      })
    } catch (err) {
      lastError = new SendError(
        `Network error on attempt ${attempt + 1}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        attempt + 1,
      )
      continue
    }

    if (response.ok) {
      const data = (await response.json()) as MetaSendResponse
      const wamid = data.messages[0]?.id
      if (!wamid) throw new SendError('Meta API returned success but no message ID in response')
      return { waMessageId: wamid }
    }

    const safeError = (await response.text()).slice(0, 200)

    if (response.status >= 400 && response.status < 500) {
      throw new SendError(`Meta API rejected interactive message (${response.status})`, response.status, attempt + 1)
    }

    lastError = new SendError(
      `Meta API server error on attempt ${attempt + 1} (${response.status}): ${safeError}`,
      response.status,
      attempt + 1,
    )
  }

  throw lastError ?? new SendError('All interactive send attempts exhausted')
}

/**
 * Sends a message with up to three tappable reply buttons. Tapping one comes
 * back through the webhook as an `interactive` message carrying the button's
 * id and title.
 *
 * Throws SendError without calling Meta when the message can't be expressed as
 * buttons (no buttons, too many, or a body over WhatsApp's 1024-char limit) —
 * callers should fall back to plain text.
 */
export async function sendInteractiveButtons(
  to: string,
  text: string,
  buttons: ReplyButton[],
  phoneNumberId: string,
  accessToken: string,
): Promise<SendResult> {
  if (buttons.length === 0 || buttons.length > MAX_REPLY_BUTTONS) {
    throw new SendError(`Reply buttons must number 1–${MAX_REPLY_BUTTONS} (got ${buttons.length})`)
  }
  if (text.length > MAX_INTERACTIVE_BODY_LENGTH) {
    throw new SendError(`Interactive body exceeds ${MAX_INTERACTIVE_BODY_LENGTH} characters`)
  }

  return postInteractive(
    to,
    {
      type: 'button',
      body: { text },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, MAX_BUTTON_TITLE_LENGTH) },
        })),
      },
    },
    phoneNumberId,
    accessToken,
  )
}

/**
 * Sends a message with a single button that opens a URL (e.g. "Connect my
 * bank"), instead of pasting a long raw link into the chat.
 */
export async function sendCtaUrlMessage(
  to: string,
  text: string,
  buttonLabel: string,
  linkUrl: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<SendResult> {
  if (text.length > MAX_INTERACTIVE_BODY_LENGTH) {
    throw new SendError(`Interactive body exceeds ${MAX_INTERACTIVE_BODY_LENGTH} characters`)
  }

  return postInteractive(
    to,
    {
      type: 'cta_url',
      body: { text },
      action: {
        name: 'cta_url',
        parameters: { display_text: buttonLabel.slice(0, MAX_BUTTON_TITLE_LENGTH), url: linkUrl },
      },
    },
    phoneNumberId,
    accessToken,
  )
}
