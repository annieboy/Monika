/**
 * Savings account recommendation service.
 *
 * Analyses a user's idle current account balance and recommends the best
 * savings/ISA offers from the live offer catalogue, ranked by AER then
 * estimated return on the user's actual balance.
 *
 * This is a monetised feature — all recommended products are affiliate offers.
 * Disclosure is included in every response.
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SAVINGS_CATEGORY_SLUGS = ['savings', 'isa', 'cash-isa', 'easy-access-savings', 'fixed-rate-savings']

interface SavingsOffer {
  id: string
  providerName: string
  title: string
  shortDescription: string
  parameters: unknown
  affiliateBaseUrl: string
}

function extractAer(parameters: unknown): number | null {
  if (!parameters || typeof parameters !== 'object') return null
  const p = parameters as Record<string, unknown>
  const aer = p['aer']
  if (aer === null || aer === undefined) return null
  const n = typeof aer === 'string' ? parseFloat(aer) : Number(aer)
  return isNaN(n) ? null : n
}

function formatOffer(offer: SavingsOffer, idleBalance: number, index: number): string {
  const aer = extractAer(offer.parameters)
  const annualReturn = aer != null ? (idleBalance * aer) / 100 : null
  let out = `*${index}. ${offer.providerName} — ${offer.title}*\n`
  if (aer != null) out += `AER: ${aer.toFixed(2)}%`
  if (annualReturn != null && annualReturn > 0) out += ` (≈${fmt(annualReturn)}/yr on your balance)`
  out += '\n'
  out += offer.shortDescription + '\n'
  return out
}

export async function getSavingsRecommendations(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  // Check bank connection
  const connection = await prisma.bankConnection.findFirst({
    where: { userId, consentStatus: 'active' },
    select: { id: true },
  })
  if (!connection) {
    return (
      `To recommend the best savings accounts for you, I need to see your balance first.\n\n` +
      `Say *"connect my bank"* to link your account — it only takes a minute.`
    )
  }

  // Get current account balance
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { currentBalance: true, accountType: true },
  })
  const idleBalance = accounts.reduce(
    (sum, acc) => sum + Number(acc.currentBalance ?? new Decimal(0)),
    0,
  )

  // Find savings offers (join via OfferCategory slug)
  const offers = await prisma.offer.findMany({
    where: {
      isActive: true,
      category: { slug: { in: SAVINGS_CATEGORY_SLUGS } },
    },
    include: { category: { select: { slug: true, name: true } } },
    orderBy: [{ createdAt: 'desc' }],
    take: 10,
  })

  if (offers.length === 0) {
    return (
      `Your balance is *${fmt(idleBalance)}*.\n\n` +
      `Right now I don't have any savings account recommendations in my catalogue, ` +
      `but as a rule of thumb: for easy access, look for accounts paying 4%+ AER. ` +
      `For money you won't need for 1–2 years, a fixed-rate ISA can offer more.\n\n` +
      `Check *MoneySavingExpert* or *Which?* for the latest best-buy tables.`
    )
  }

  // Sort by AER descending
  const sorted = offers
    .map(o => ({ ...o, aer: extractAer(o.parameters) }))
    .sort((a, b) => (b.aer ?? 0) - (a.aer ?? 0))
    .slice(0, 3)

  let out = `💰 *Savings recommendations for you*\n\n`
  out += `Your idle balance: *${fmt(idleBalance)}*\n\n`
  out += `Here are the top accounts from our catalogue:\n\n`

  sorted.forEach((offer, i) => {
    out += formatOffer(offer, idleBalance, i + 1)
    out += '\n'
  })

  out += `Reply *"tell me more about ${sorted[0]?.providerName ?? 'the first option'}"* for details or to apply.\n\n`
  out += `_These are partner offers. Monika may earn a commission if you apply — this doesn't affect the rate you receive._`

  return out
}

export function isSavingsRecommendationRequest(message: string): boolean {
  return /recommend|suggest|best\s+savings|where\s+should\s+i\s+(put|save|keep)\s+(?:my\s+)?(?:savings|money|cash)|which\s+savings|good\s+savings\s+account/i.test(message)
}
