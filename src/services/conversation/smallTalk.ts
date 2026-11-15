/**
 * Small talk: greetings and thank-yous.
 *
 * A bare "hi" or "thanks" isn't a money question, so sending it through intent
 * classification either costs an LLM call or ends in "I didn't understand".
 * Instead Monika answers like a person would — by name, with a couple of
 * tappable shortcuts to the things people ask most.
 *
 * Only messages that are NOTHING BUT a greeting/thank-you are handled here;
 * "hi, what's my balance?" goes through normal routing.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { config } from '../../config.js'
import type { ReplyButton } from '../whatsapp/sender.js'

export interface SmallTalkResult {
  intent: 'greeting' | 'thanks'
  response: string
  buttons?: ReplyButton[]
}

const GREETING =
  /^\s*(?:hi+|hey+|hello+|hiya|heya|yo|howdy|good\s+(?:morning|afternoon|evening)|morning|afternoon|evening)(?:\s+(?:there|monika))?\s*[!.,]*\s*(?:👋)?\s*$/i

const THANKS =
  /^\s*(?:thanks?(?:\s+(?:you|a\s+lot|so\s+much|very\s+much))*|thank\s+you(?:\s+(?:so|very)\s+much)?|thx|ty|cheers|much\s+appreciated)(?:\s+monika)?\s*[!.,]*\s*(?:🙏|👍|😊)?\s*$/i

export function isGreeting(text: string): boolean {
  return GREETING.test(text)
}

export function isThanks(text: string): boolean {
  return THANKS.test(text)
}

// Button labels double as the question they ask when tapped (a tap arrives as
// its label), so each must classify correctly on its own. Max 20 characters.
const CONNECTED_SHORTCUTS: ReplyButton[] = [
  { id: 'shortcut_balance', title: 'My balance' },
  { id: 'shortcut_spending', title: 'Spending this month' },
  { id: 'shortcut_help', title: 'What can you do?' },
]

const NOT_CONNECTED_SHORTCUTS: ReplyButton[] = [
  { id: 'shortcut_connect', title: 'Connect my bank' },
  { id: 'shortcut_help', title: 'What can you do?' },
]

/** "Good morning" / "Good afternoon" / "Good evening" by UK local time. */
function timeOfDayGreeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(now),
  )
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

async function firstName(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullNameEnc: true } })
  if (!user?.fullNameEnc) return null
  try {
    const name = decrypt(Buffer.from(user.fullNameEnc), config.ENCRYPTION_KEY).toString('utf-8').trim()
    return name.length > 0 ? name : null
  } catch {
    return null
  }
}

/**
 * Returns a reply if `text` is purely a greeting or a thank-you, else null.
 */
export async function handleSmallTalk(
  prisma: PrismaClient,
  userId: string,
  text: string,
  now: Date = new Date(),
): Promise<SmallTalkResult | null> {
  const greeting = isGreeting(text)
  if (!greeting && !isThanks(text)) return null

  const name = await firstName(prisma, userId)

  if (!greeting) {
    return {
      intent: 'thanks',
      response: `You're welcome${name ? `, ${name}` : ''}! Anything else you'd like to check?`,
    }
  }

  const connection = await prisma.bankConnection.findFirst({
    where: { userId, consentStatus: 'active' },
    select: { id: true },
  })
  const hello = `${timeOfDayGreeting(now)}${name ? `, ${name}` : ''} 👋`

  if (connection) {
    return {
      intent: 'greeting',
      response: `${hello}\n\nWhat would you like to check? Tap a shortcut below, or just ask me anything about your money.`,
      buttons: CONNECTED_SHORTCUTS,
    }
  }

  return {
    intent: 'greeting',
    response:
      `${hello} I'm Monika, your money assistant.\n\n` +
      `Connect your bank and I can answer questions about your balance, spending, bills and more. ` +
      `It takes about a minute and it's read-only — I can never move your money.`,
    buttons: NOT_CONNECTED_SHORTCUTS,
  }
}
