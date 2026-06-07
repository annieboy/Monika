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
