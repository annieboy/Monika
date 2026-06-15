/**
 * Broadband & mobile switching detector.
 *
 * Checks the user's recurring broadband/mobile payments against live
 * offers in the catalogue. If the user is paying above the offer price,
 * surfaces the saving opportunity with an affiliate link.
 *
 * FCA / switching disclaimer always included.
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const BROADBAND_KEYWORDS = ['broadband', 'virgin media', 'bt ', 'sky broadband', 'talktalk', 'plusnet', 'vodafone broadband', 'now broadband']
const MOBILE_KEYWORDS = ['o2', 'vodafone', 'ee ', 'three ', '3 mobile', 'giffgaff', 'smarty', 'lebara', 'lycamobile', 'tesco mobile', 'sky mobile']

function detectCategory(merchantName: string): 'broadband' | 'mobile' | null {
  const lower = merchantName.toLowerCase()
  if (BROADBAND_KEYWORDS.some(k => lower.includes(k))) return 'broadband'
  if (MOBILE_KEYWORDS.some(k => lower.includes(k))) return 'mobile'
  return null
}

export async function checkSwitchingOpportunity(
  prisma: PrismaClient,
  userId: string,
  filterCategory?: 'broadband' | 'mobile',
): Promise<string> {
  const recurring = await prisma.recurringPayment.findMany({
    where: { userId, isActive: true },
    select: { merchantName: true, typicalAmount: true, frequency: true },
  })

  // Identify broadband and mobile recurring payments
  type RecurringMatch = { merchantName: string; monthly: number; category: 'broadband' | 'mobile' }
  const matches: RecurringMatch[] = []
  for (const r of recurring) {
    const cat = detectCategory(r.merchantName)
    if (!cat) continue
    if (filterCategory && cat !== filterCategory) continue
    const raw = Number(r.typicalAmount)
    // Normalise to monthly
    const monthly = r.frequency === 'annual' ? raw / 12
      : r.frequency === 'quarterly' ? raw / 3
      : r.frequency === 'weekly' ? raw * 4.33
      : raw
    matches.push({ merchantName: r.merchantName, monthly, category: cat })
  }

  if (matches.length === 0) {
    const label = filterCategory ?? 'broadband or mobile'
    return (
      `I couldn't find any regular ${label} payments in your transactions.\n\n` +
      `If you pay for ${label} make sure your bank is connected and I'll automatically spot it.`
    )
  }

  // Load offers from catalogue
  const offers = await prisma.offer.findMany({
    where: {
      isActive: true,
      category: {
        slug: { in: filterCategory ? [filterCategory] : ['broadband', 'mobile'] },
      },
    },
    include: { category: { select: { slug: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  let out = filterCategory
    ? `📡 *${filterCategory === 'broadband' ? 'Broadband' : 'Mobile'} switching check*\n\n`
    : `📡 *Broadband & mobile switching check*\n\n`

  let foundSaving = false

  for (const match of matches) {
    out += `*${match.merchantName}* — you're paying approx. ${fmt(match.monthly)}/month\n`

    const relevantOffers = offers
      .filter(o => o.category.slug === match.category)
      .map(o => {
        const params = o.parameters as Record<string, unknown>
        const offerMonthly = Number(params.monthlyPrice ?? 0)
        return { ...o, offerMonthly }
      })
      .filter(o => o.offerMonthly > 0 && o.offerMonthly < match.monthly)
      .sort((a, b) => a.offerMonthly - b.offerMonthly)

    if (relevantOffers.length === 0) {
      out += `No cheaper offers found in our catalogue right now.\n\n`
    } else {
      const best = relevantOffers[0]!
      const monthlySaving = match.monthly - best.offerMonthly
      const annualSaving = monthlySaving * 12
      foundSaving = true

      out += `💡 *${best.providerName} — ${best.title}* at ${fmt(best.offerMonthly)}/month\n`
      out += `Potential saving: *${fmt(monthlySaving)}/month (${fmt(annualSaving)}/year)*\n`
      out += `${best.shortDescription}\n\n`
    }
  }

  if (foundSaving) {
    out += `_These are partner offers. Monika may earn a commission — this doesn't affect the prices shown. Check coverage, contract length, and early termination charges with your current provider before switching._`
  } else {
    out += `You appear to be on competitive rates. Check comparison sites like *uSwitch*, *MoneySuperMarket*, or *Broadband Choices* for the latest deals.`
  }

  return out
}

export function isSwitchingRequest(message: string): boolean {
  return /(?:switch|chang|cheaper|saving|overpay|too\s+much|best\s+deal).*(?:broadband|mobile|phone\s+plan|sim|wifi|internet)|(?:broadband|mobile|phone\s+plan|sim|wifi|internet).*(?:switch|chang|cheaper|saving|overpay|best\s+deal)|am\s+i\s+paying\s+too\s+much.*(?:broadband|mobile|internet|wifi)/i.test(message)
}

export function extractSwitchingCategory(message: string): 'broadband' | 'mobile' | undefined {
  if (/broadband|internet|wifi|fibre/i.test(message)) return 'broadband'
  if (/mobile|sim|phone\s+plan|data\s+plan/i.test(message)) return 'mobile'
  return undefined
}
