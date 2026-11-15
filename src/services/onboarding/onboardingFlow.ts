/**
 * WhatsApp onboarding conversation flow.
 *
 * Intercepts messages from users who haven't completed onboarding and
 * walks them through three steps — in order — before normal intent routing:
 *
 *   Step 1 — Name capture:     fullNameEnc is null
 *   Step 2 — Terms acceptance: termsAcceptedAt is null
 *   Step 3 — Marketing opt-in: gdprConsentAt is null
 *
 * Each step persists its result to the User row immediately. On the final
 * step the user receives a welcome message and subsequent messages go through
 * normal routing.
 *
 * State is derived from the User record — no extra table needed.
 */
import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../lib/crypto.js'
import { config } from '../../config.js'
import type { ReplyButton } from '../whatsapp/sender.js'

export const TERMS_VERSION = '1.0'

const TERMS_URL = `${config.APP_BASE_URL}/legal/terms`
const PRIVACY_URL = `${config.APP_BASE_URL}/legal/privacy`

// ── Step prompts ──────────────────────────────────────────────────────────────

export const PROMPT_NAME =
  `Hi! I'm Monika, your personal UK finance assistant 👋\n\n` +
  `I can help you track spending, spot savings, and hit your money goals — all via WhatsApp.\n\n` +
  `To get started, what's your first name?`

export const PROMPT_TERMS = (name: string): string =>
  `Nice to meet you, ${name}! 🎉\n\n` +
  `Before we dive in, I need you to agree to our Terms of Service and Privacy Policy:\n\n` +
  `📄 Terms: ${TERMS_URL}\n` +
  `🔒 Privacy: ${PRIVACY_URL}\n\n` +
  `Tap *I agree* below to accept — or reply *YES* / *NO*.`

export const PROMPT_MARKETING =
  `Great, you're all set legally ✅\n\n` +
  `Would you like to receive personalised money-saving tips and offers via WhatsApp?\n\n` +
  `Tap a button below, or reply *YES* / *NO* — you can change this anytime.`

export const PROMPT_COMPLETE = (name: string): string =>
  `Welcome aboard, ${name}! 🚀\n\n` +
  `You can ask me things like:\n` +
  `• *"How much did I spend on groceries this month?"*\n` +
  `• *"What subscriptions am I paying for?"*\n` +
  `• *"Can I afford a £500 weekend away?"*\n` +
  `• *"I want to save £2,000 for a holiday by December"*\n\n` +
  `Say *"connect my bank"* to link your account and unlock full insights.`

export const PROMPT_TERMS_DECLINED =
  `No problem. If you change your mind, just message us again.\n\n` +
  `We'll need your agreement to our Terms to use Monika.`

// ── Reply buttons ─────────────────────────────────────────────────────────────
// A tap arrives as the button's label, so every label must read as a clear
// yes/no to isYes/isNo below. Max 20 characters each.

export const TERMS_BUTTONS: ReplyButton[] = [
  { id: 'terms_yes', title: 'I agree' },
  { id: 'terms_no', title: 'No thanks' },
]

export const MARKETING_BUTTONS: ReplyButton[] = [
  { id: 'marketing_yes', title: 'Yes please' },
  { id: 'marketing_no', title: 'No thanks' },
]

export const COMPLETE_BUTTONS: ReplyButton[] = [
  { id: 'shortcut_connect', title: 'Connect my bank' },
  { id: 'shortcut_help', title: 'What can you do?' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OnboardingResult {
  handled: boolean
  response: string
  /** Suggested tappable replies for this step, when it has a fixed set of answers. */
  buttons?: ReplyButton[]
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isYes(text: string): boolean {
  return /^\s*(?:y|yes|yep|yeah|yup|ok|okay|sure|accept|agree|i\s+agree|yes,?\s+i\s+agree|yes\s+please)\s*[.!]*\s*$/i.test(text)
}

function isNo(text: string): boolean {
  return /^\s*(?:n|no|nope|nah|no\s+thanks|no\s+thank\s+you|not\s+now|decline)\s*[.!]*\s*$/i.test(text)
}

function decryptName(encBytes: Uint8Array | Buffer | null, encKey: string): string | null {
  if (!encBytes) return null
  try {
    return decrypt(Buffer.from(encBytes), encKey).toString('utf-8')
  } catch {
    return null
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Call before intent classification. Returns handled=true + a response if this
 * message belongs to an incomplete onboarding flow. Returns handled=false when
 * onboarding is complete and normal routing should proceed.
 */
export async function handleOnboardingStep(
  prisma: PrismaClient,
  userId: string,
  text: string,
): Promise<OnboardingResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      fullNameEnc: true,
      termsAcceptedAt: true,
      gdprConsentAt: true,
    },
  })

  // ── Step 1: Name capture ─────────────────────────────────────────────────
  if (!user.fullNameEnc) {
    // If we haven't yet shown the welcome/name prompt, show it now.
    const promptShown = await prisma.conversation.count({
      where: { userId, role: 'assistant', modelUsed: 'onboarding' },
    })
    if (promptShown === 0) {
      return { handled: true, response: PROMPT_NAME }
    }

    // We already asked — the current message IS the name reply.
    const name = text.trim().split(/\s+/)[0] ?? text.trim()
    if (!name || name.length < 2 || name.length > 64) {
      return { handled: true, response: `Please tell me your first name (2–64 characters).` }
    }

    const nameEnc = encrypt(Buffer.from(name, 'utf-8'), config.ENCRYPTION_KEY) as unknown as Uint8Array<ArrayBuffer>
    await prisma.user.update({
      where: { id: userId },
      data: { fullNameEnc: nameEnc },
    })

    return { handled: true, response: PROMPT_TERMS(name), buttons: TERMS_BUTTONS }
  }

  // ── Step 2: Terms acceptance ─────────────────────────────────────────────
  if (!user.termsAcceptedAt) {
    if (isNo(text)) {
      return { handled: true, response: PROMPT_TERMS_DECLINED }
    }

    if (!isYes(text)) {
      // Re-prompt — user hasn't given a clear answer yet
      const name = decryptName(user.fullNameEnc as Buffer | null, config.ENCRYPTION_KEY) ?? 'there'
      return { handled: true, response: PROMPT_TERMS(name), buttons: TERMS_BUTTONS }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      },
    })

    return { handled: true, response: PROMPT_MARKETING, buttons: MARKETING_BUTTONS }
  }

  // ── Step 3: Marketing / GDPR consent ────────────────────────────────────
  if (!user.gdprConsentAt) {
    if (!isYes(text) && !isNo(text)) {
      return { handled: true, response: PROMPT_MARKETING, buttons: MARKETING_BUTTONS }
    }

    const marketingConsent = isYes(text)
    await prisma.user.update({
      where: { id: userId },
      data: {
        gdprConsentAt: new Date(),
        marketingConsent,
      },
    })

    const name = decryptName(user.fullNameEnc as Buffer | null, config.ENCRYPTION_KEY) ?? 'there'
    return { handled: true, response: PROMPT_COMPLETE(name), buttons: COMPLETE_BUTTONS }
  }

  // Onboarding complete — let normal routing handle this message
  return { handled: false, response: '' }
}
