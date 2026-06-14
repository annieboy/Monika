/**
 * Charity and donation tracker.
 *
 * Detects charitable giving by looking for known charity keywords/names in
 * transaction descriptions, or the 'charity' / 'donation' category.
 *
 * Reports:
 *   - Total donated in the current tax year
 *   - Gift Aid uplift (25p per £1 donated for basic-rate taxpayers)
 *   - Donation list with dates and amounts
 *
 * Useful for self-assessment (Gift Aid declarations) and personal giving goals.
 */
import type { PrismaClient } from '@prisma/client'

export interface DonationRecord {
  id: string
  date: Date
  merchant: string | null
  amount: number
  description: string | null
}

export interface CharitySummary {
  donations: DonationRecord[]
  totalDonated: number
  giftAidUplift: number      // 25% of donated amount
  taxYear: string
  fromDate: Date
  toDate: Date
}

const CHARITY_KEYWORDS = /\b(charity|charities|donation|donate|gofundme|justgiving|virgin\s+money\s+giving|comic\s+relief|red\s+cross|oxfam|unicef|cancer\s+research|british\s+heart|save\s+the\s+children|nspcc|rspca|shelter|mind\s+charity|macmillan|marie\s+curie)\b/i
const CHARITY_CATEGORIES = new Set(['charity', 'donations', 'charitable giving', 'giving'])
const GIFT_AID_RATE = 0.25

function getTaxYearDates(now: Date): { from: Date; to: Date; label: string } {
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()
  const startYear = month > 3 || (month === 3 && day >= 6) ? year : year - 1
  return {
    from: new Date(startYear, 3, 6),
    to: new Date(startYear + 1, 3, 5, 23, 59, 59, 999),
    label: `${startYear}/${String(startYear + 1).slice(2)}`,
  }
}

export async function getCharitySummary(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<CharitySummary> {
  const { from, to, label } = getTaxYearDates(now)

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      transactionDate: { gte: from, lte: to },
      amount: { lt: 0 },
      OR: [
        { category: { in: ['charity', 'donations', 'charitable giving', 'giving'] } },
        { merchantNameClean: { contains: 'charity', mode: 'insensitive' } },
        { cleanDescription: { contains: 'donation', mode: 'insensitive' } },
        { rawDescription: { contains: 'charity', mode: 'insensitive' } },
        { rawDescription: { contains: 'donation', mode: 'insensitive' } },
        { rawDescription: { contains: 'justgiving', mode: 'insensitive' } },
        { rawDescription: { contains: 'gofundme', mode: 'insensitive' } },
      ],
    },
    orderBy: { transactionDate: 'desc' },
    select: {
      id: true,
      transactionDate: true,
      merchantNameClean: true,
      merchantName: true,
      amount: true,
      cleanDescription: true,
      rawDescription: true,
      category: true,
    },
  })

  // Post-filter: also include any rows whose description matches charity keywords
  const allTxRows = await prisma.transaction.findMany({
    where: {
      userId,
      transactionDate: { gte: from, lte: to },
      amount: { lt: 0 },
      category: null,
    },
    select: {
      id: true,
      transactionDate: true,
      merchantNameClean: true,
      merchantName: true,
      amount: true,
      cleanDescription: true,
      rawDescription: true,
      category: true,
    },
    take: 1000,
  })

  const extraCharity = allTxRows.filter(r => {
    const desc = `${r.cleanDescription ?? ''} ${r.rawDescription ?? ''} ${r.merchantNameClean ?? ''} ${r.merchantName ?? ''}`
    return CHARITY_KEYWORDS.test(desc) && !CHARITY_CATEGORIES.has((r.category ?? '').toLowerCase())
  })

  const seenIds = new Set<string>()
  const combined: typeof rows = []
  for (const r of [...rows, ...extraCharity]) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id)
      combined.push(r)
    }
  }

  const donations: DonationRecord[] = combined.map(r => ({
    id: r.id,
    date: r.transactionDate,
    merchant: r.merchantNameClean ?? r.merchantName ?? null,
    amount: Math.abs(Number(r.amount)),
    description: r.cleanDescription ?? r.rawDescription ?? null,
  }))

  const totalDonated = donations.reduce((s, d) => s + d.amount, 0)

  return {
    donations,
    totalDonated,
    giftAidUplift: totalDonated * GIFT_AID_RATE,
    taxYear: label,
    fromDate: from,
    toDate: to,
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function formatCharitySummary(summary: CharitySummary): string {
  if (summary.donations.length === 0) {
    return `❤️ No charitable donations detected in the ${summary.taxYear} tax year.\n\n_If you've donated but they're not showing, the merchant name may not be recognised as a charity._`
  }

  let out = `❤️ *Charitable giving — ${summary.taxYear} tax year*\n\n`
  out += `Total donated: *${fmt(summary.totalDonated)}*\n`
  out += `Gift Aid uplift (25%): *+${fmt(summary.giftAidUplift)}* ← HMRC adds this to your chosen charities\n\n`

  out += `*Donations:*\n`
  for (const d of summary.donations.slice(0, 10)) {
    const label = d.merchant ?? d.description ?? 'Donation'
    out += `  • ${fmtDate(d.date)} — ${label}: ${fmt(d.amount)}\n`
  }
  if (summary.donations.length > 10) {
    out += `  _…and ${summary.donations.length - 10} more_\n`
  }

  out += `\n_Make sure you've completed a Gift Aid declaration with each charity to claim the uplift. Consult a tax adviser for eligibility._`

  return out.trim()
}
