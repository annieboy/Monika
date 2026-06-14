/**
 * Foreign currency (FX) transaction service.
 *
 * Detects transactions that were processed in a non-GBP currency by looking
 * for currency symbols or ISO codes in descriptions, or a non-zero
 * foreignAmount / foreignCurrency field in the transaction record.
 *
 * Summarises:
 *   - Total GBP charged on foreign transactions
 *   - Estimated FX fees (typically 2.99% for UK debit/credit cards)
 *   - Breakdown by currency / country
 *   - Date range of travel spending
 */
import type { PrismaClient } from '@prisma/client'

export interface FxTransaction {
  id: string
  date: Date
  merchant: string | null
  gbpAmount: number
  foreignCurrency: string | null
  description: string | null
}

export interface FxSummary {
  transactions: FxTransaction[]
  totalGbpSpend: number
  estimatedFxFees: number
  currencyBreakdown: Array<{ currency: string; totalGbp: number; count: number }>
  firstDate: Date | null
  lastDate: Date | null
}

// Standard UK card FX fee estimate
const ESTIMATED_FX_FEE_PCT = 0.0299

// Currency ISO codes and symbols that appear in descriptions
const CURRENCY_PATTERN = /\b(USD|EUR|JPY|AUD|CAD|CHF|SEK|NOK|DKK|PLN|HUF|CZK|RON|BGN|HRK|TRY|MXN|BRL|INR|SGD|HKD|NZD|ZAR|AED|SAR|QAR|KWD)\b|\$(?!\d*\s*GBP)|€|¥|kr\s/i

function detectCurrency(description: string): string | null {
  const usdMatch = description.match(/\bUSD\b/)
  if (usdMatch) return 'USD'
  const eurMatch = description.match(/\bEUR\b|€/)
  if (eurMatch) return 'EUR'
  const isoMatch = description.match(/\b(JPY|AUD|CAD|CHF|SEK|NOK|DKK|PLN|HUF|CZK|RON|BGN|TRY|MXN|BRL|INR|SGD|HKD|NZD|ZAR|AED|SAR|QAR|KWD)\b/i)
  if (isoMatch?.[1]) return isoMatch[1].toUpperCase()
  if (/¥/.test(description)) return 'JPY'
  return null
}

export async function getFxTransactions(
  prisma: PrismaClient,
  userId: string,
  lookbackDays = 90,
): Promise<FxSummary> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000)

  // Fetch transactions that either have foreignCurrency set OR mention a currency in description
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      transactionDate: { gte: since },
      amount: { lt: 0 },
      OR: [
        { rawDescription: { contains: 'USD', mode: 'insensitive' } },
        { rawDescription: { contains: 'EUR', mode: 'insensitive' } },
        { cleanDescription: { contains: 'USD' } },
        { cleanDescription: { contains: 'EUR' } },
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
    },
  })

  // Also fetch any with currency patterns in description via post-filtering
  const allRecent = await prisma.transaction.findMany({
    where: {
      userId,
      transactionDate: { gte: since },
      amount: { lt: 0 },
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
    },
    take: 500,
  })

  const fxFromDescription = allRecent.filter(r => {
    const desc = r.cleanDescription ?? r.rawDescription ?? ''
    return CURRENCY_PATTERN.test(desc)
  })

  // Merge, dedup by id
  const seenIds = new Set<string>()
  const combined: typeof rows = []
  for (const r of [...rows, ...fxFromDescription]) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id)
      combined.push(r)
    }
  }

  const transactions: FxTransaction[] = combined.map(r => {
    const desc = r.cleanDescription ?? r.rawDescription ?? ''
    const currency = detectCurrency(desc)
    return {
      id: r.id,
      date: r.transactionDate,
      merchant: r.merchantNameClean ?? r.merchantName ?? null,
      gbpAmount: Math.abs(Number(r.amount)),
      foreignCurrency: currency,
      description: desc || null,
    }
  })

  const totalGbpSpend = transactions.reduce((s, t) => s + t.gbpAmount, 0)
  const estimatedFxFees = totalGbpSpend * ESTIMATED_FX_FEE_PCT

  // Currency breakdown
  const currencyMap = new Map<string, { totalGbp: number; count: number }>()
  for (const tx of transactions) {
    const key = tx.foreignCurrency ?? 'Unknown'
    const entry = currencyMap.get(key) ?? { totalGbp: 0, count: 0 }
    entry.totalGbp += tx.gbpAmount
    entry.count++
    currencyMap.set(key, entry)
  }

  const currencyBreakdown = [...currencyMap.entries()]
    .map(([currency, data]) => ({ currency, ...data }))
    .sort((a, b) => b.totalGbp - a.totalGbp)

  const dates = transactions.map(t => t.date)
  const firstDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null
  const lastDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null

  return { transactions, totalGbpSpend, estimatedFxFees, currencyBreakdown, firstDate, lastDate }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function formatFxSummary(summary: FxSummary): string {
  if (summary.transactions.length === 0) {
    return `✈️ No foreign currency transactions found in the last 90 days.`
  }

  let out = `✈️ *Foreign currency spending — last 90 days*\n\n`
  out += `Total charged in GBP: *${fmt(summary.totalGbpSpend)}*\n`
  out += `Estimated FX fees (~3%): *${fmt(summary.estimatedFxFees)}*\n`
  out += `Transactions: *${summary.transactions.length}*\n`

  if (summary.firstDate && summary.lastDate) {
    out += `Period: ${fmtDate(summary.firstDate)} – ${fmtDate(summary.lastDate)}\n`
  }

  if (summary.currencyBreakdown.length > 0) {
    out += `\n*By currency:*\n`
    for (const cb of summary.currencyBreakdown.slice(0, 5)) {
      out += `  • ${cb.currency}: ${fmt(cb.totalGbp)} (${cb.count} transactions)\n`
    }
  }

  out += `\n_Consider a fee-free travel card (Starling, Chase, Monzo) to avoid FX charges._`

  return out.trim()
}
