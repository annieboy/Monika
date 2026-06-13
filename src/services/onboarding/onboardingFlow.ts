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

export const TERMS_VERSION = '1.0'

const TERMS_URL = `${config.APP_BASE_URL}/legal/terms`
const PRIVACY_URL = `${config.APP_BASE_URL}/legal/privacy`

// ── Step prompts ──────────────────────────────────────────────────────────────

export const PROMPT_NAME =
  `Hi! I'm Monika, your personal UK finance assistant 👋\n\n` +
  `I can help you track spending, spot savings, and hit your money goals — all via WhatsApp.\n\n` +
  `To get started, what's your first name?`

export const PROMPT_TERMS = (name: string) =>
  `Nice to meet you, ${name}! 🎉\n\n` +
  `Before we dive in, I need you to agree to our Terms of Service and Privacy Policy:\n\n` +
  `📄 Terms: ${TERMS_URL}\n` +
  `🔒 Privacy: ${PRIVACY_URL}\n\n` +
  `Reply *YES* to accept, or *NO* to cancel.`

export const PROMPT_MARKETING =
  `Great, you're all set legally ✅\n\n` +
  `Would you like to receive personalised money-saving tips and offers via WhatsApp?\n\n` +
  `Reply *YES* or *NO* — you can change this anytime.`

export const PROMPT_COMPLETE = (name: string) =>
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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OnboardingResult {
  handled: boolean
  response: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isYes(text: string): boolean {
  return /^\s*y(es|ep|eah|)?\s*$/i.test(text.trim())
}

function isNo(text: string): boolean {
  return /^\s*n(o|ope|ah|)?\s*$/i.test(text.trim())
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

    return { handled: true, response: PROMPT_TERMS(name) }
  }

  // ── Step 2: Terms acceptance ─────────────────────────────────────────────
  if (!user.termsAcceptedAt) {
    if (isNo(text)) {
      return { handled: true, response: PROMPT_TERMS_DECLINED }
    }

    if (!isYes(text)) {
      // Re-prompt — user hasn't given a clear answer yet
      const name = decryptName(user.fullNameEnc as Buffer | null, config.ENCRYPTION_KEY) ?? 'there'
      return { handled: true, response: PROMPT_TERMS(name) }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      },
    })

    return { handled: true, response: PROMPT_MARKETING }
  }

  // ── Step 3: Marketing / GDPR consent ────────────────────────────────────
  if (!user.gdprConsentAt) {
    if (!isYes(text) && !isNo(text)) {
      return { handled: true, response: PROMPT_MARKETING }
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
    return { handled: true, response: PROMPT_COMPLETE(name) }
  }

  // Onboarding complete — let normal routing handle this message
  return { handled: false, response: '' }
}
