/**
 * Decides HOW a reply is delivered on WhatsApp — plain text, text with tappable
 * reply buttons, or text with a link button — and sends it.
 *
 * The rest of the app only produces text (plus, optionally, a few suggested
 * reply buttons). Keeping the presentation choice here means every handler
 * benefits, and a failed interactive send always degrades to the plain text
 * the user would have got before.
 */
import {
  sendWhatsAppMessage,
  sendInteractiveButtons,
  sendCtaUrlMessage,
  SendError,
  MAX_INTERACTIVE_BODY_LENGTH,
  MAX_REPLY_BUTTONS,
  type ReplyButton,
  type SendResult,
} from './sender.js'

export interface OutboundMessage {
  /** Body to show alongside buttons / a link button. */
  text: string
  /** The original plain-text reply — used when there is nothing interactive, or if the interactive send fails. */
  fallbackText: string
  buttons?: ReplyButton[]
  cta?: { label: string; url: string }
}

const CONNECT_LINK = /https?:\/\/\S+\/banking\/start\?token=[0-9a-f]+/i
const CONNECT_BUTTON_LABEL = 'Connect my bank'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Turns a text reply (and optional suggested buttons) into the best WhatsApp
 * presentation:
 *   - a bank-connect link becomes a "Connect my bank" button, with the raw URL
 *     taken out of the message body;
 *   - otherwise suggested reply buttons are attached;
 *   - anything too long for an interactive body stays plain text.
 */
export function buildOutbound(response: string, buttons?: ReplyButton[]): OutboundMessage {
  const plain: OutboundMessage = { text: response, fallbackText: response }

  const link = response.match(CONNECT_LINK)?.[0]
  if (link) {
    const body = response
      // "…tap this link — it expires in 15 minutes:\n<url>" → "…tap the button below — it expires in 15 minutes."
      .replace(new RegExp(`:\\s*\\n${escapeRegExp(link)}`), '.')
      .replace(link, '')
      .replace(/tap this link/i, 'tap the button below')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (body.length > 0 && body.length <= MAX_INTERACTIVE_BODY_LENGTH) {
      return { text: body, fallbackText: response, cta: { label: CONNECT_BUTTON_LABEL, url: link } }
    }
    return plain
  }

  if (buttons && buttons.length > 0 && buttons.length <= MAX_REPLY_BUTTONS && response.length <= MAX_INTERACTIVE_BODY_LENGTH) {
    return { text: response, fallbackText: response, buttons }
  }

  return plain
}

/**
 * Sends an OutboundMessage. If WhatsApp rejects the interactive form, the user
 * still gets the plain-text reply rather than nothing.
 */
export async function sendOutbound(
  to: string,
  message: OutboundMessage,
  phoneNumberId: string,
  accessToken: string,
): Promise<SendResult> {
  try {
    if (message.cta) {
      return await sendCtaUrlMessage(to, message.text, message.cta.label, message.cta.url, phoneNumberId, accessToken)
    }
    if (message.buttons) {
      return await sendInteractiveButtons(to, message.text, message.buttons, phoneNumberId, accessToken)
    }
  } catch (err) {
    if (!(err instanceof SendError)) throw err
    // fall through to plain text
  }
  return sendWhatsAppMessage(to, message.fallbackText, phoneNumberId, accessToken)
}
