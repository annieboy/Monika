/**
 * Natural-language transaction search.
 *
 * Parses a user's question into structured filters and returns matching
 * transactions. Supports:
 *   - Merchant name ("at Sainsbury's", "from Amazon")
 *   - Category ("on eating out", "on transport")
 *   - Date range ("last week", "in January", "last 30 days")
 *   - Amount threshold ("over £50", "more than £100")
 *   - Transaction type ("income", "refunds")
 */
import type { PrismaClient, Prisma } from '@prisma/client'

export interface TransactionSearchFilters {
  merchantName?: string
  category?: string
  from?: Date
  to?: Date
  amountGte?: number    // min absolute value
  amountLte?: number    // max absolute value
  isRefund?: boolean
  isSalary?: boolean
  limit?: number
}

export interface TransactionSearchResult {
  id: string
  date: Date
  merchant: string | null
  category: string | null
  amount: number          // positive = credit, negative = debit
  description: string | null
}

// ── NLP filter extraction ────────────────────────────────────────────────────

export function parseTransactionSearch(message: string): TransactionSearchFilters | null {
  // "all"/"every" payments → list more and let the formatter summarise if long.
  const wantsAll = /\b(all|every|list\s+all|show\s+all)\b/i.test(message)
  const filters: TransactionSearchFilters = { limit: wantsAll ? 50 : 10 }
  let hasFilter = false

  // Merchant: "at Tesco", "from Amazon", "on Deliveroo", "to Netflix", "with Uber"
  const merchantMatch = message.match(/(?:at|from|on|to|with)\s+([A-Za-z0-9&' ]+?)(?:\s+(?:last|this|in|over|more|since|before|\?|$))|(?:payments?|transactions?)\s+(?:to|at|for|from)\s+([A-Za-z0-9&' ]+?)(?:\s+(?:last|this|in|over|more|since|before|\?|$)|$)/i)
  if (merchantMatch) {
    const term = (merchantMatch[1] ?? merchantMatch[2] ?? '').trim()
    // Exclude date/time words that look like merchants
    if (term && !/^(last|this|week|month|year|today|yesterday|january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(term)) {
      filters.merchantName = term
      hasFilter = true
    }
  }

  // Category: "spending on groceries", "food transactions"
  const categoryMatch = message.match(/(?:spent?\s+on|spending\s+on|categoris(?:ed)?\s+as)\s+([\w\s]+?)(?:\s+(?:last|this|in|over|more|since|\?|$))/i)
  if (categoryMatch?.[1]) {
    filters.category = categoryMatch[1].trim().toLowerCase()
    hasFilter = true
  }

  // Date ranges
  const now = new Date()
  if (/\btoday\b|so\s+far\s+today|this\s+morning/i.test(message)) {
    filters.from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    filters.to = now
    hasFilter = true
  } else if (/yesterday/i.test(message)) {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    filters.from = y
    filters.to = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999)
    hasFilter = true
  } else if (/this\s+week/i.test(message)) {
    const daysSinceMonday = (now.getDay() + 6) % 7
    filters.from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday)
    filters.to = now
    hasFilter = true
  } else if (/last\s+week/i.test(message)) {
    filters.from = new Date(now.getTime() - 7 * 86_400_000)
    filters.to = now
    hasFilter = true
  } else if (/last\s+month/i.test(message)) {
    filters.from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    filters.to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    hasFilter = true
  } else if (/this\s+month/i.test(message)) {
    filters.from = new Date(now.getFullYear(), now.getMonth(), 1)
    filters.to = now
    hasFilter = true
  } else if (/last\s+(\d+)\s+days?/i.test(message)) {
    const days = parseInt(message.match(/last\s+(\d+)\s+days?/i)?.[1] ?? '30')
    filters.from = new Date(now.getTime() - days * 86_400_000)
    filters.to = now
    hasFilter = true
  } else {
    // Named month: "in January", "in March 2025"
    const monthMatch = message.match(/in\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i)
    if (monthMatch) {
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
      const month = months.indexOf(monthMatch[1]!.toLowerCase())
      const year = monthMatch[2] ? parseInt(monthMatch[2]) : now.getFullYear()
      filters.from = new Date(year, month, 1)
      filters.to = new Date(year, month + 1, 0, 23, 59, 59, 999)
      hasFilter = true
    }
  }

  // Amount filters: "over £50", "more than £100"
  const amountGteMatch = message.match(/(?:over|more\s+than|above|greater\s+than)\s+£([\d,]+(?:\.\d{1,2})?)/i)
  if (amountGteMatch?.[1]) {
    filters.amountGte = parseFloat(amountGteMatch[1].replace(/,/g, ''))
    hasFilter = true
  }

  const amountLteMatch = message.match(/(?:under|less\s+than|below)\s+£([\d,]+(?:\.\d{1,2})?)/i)
  if (amountLteMatch?.[1]) {
    filters.amountLte = parseFloat(amountLteMatch[1].replace(/,/g, ''))
    hasFilter = true
  }

  // Type flags
  if (/refund/i.test(message)) { filters.isRefund = true; hasFilter = true }
  if (/salary|income|pay\s+(?:cheque|check)/i.test(message)) { filters.isSalary = true; hasFilter = true }

  return hasFilter ? filters : null
}

// ── DB query ─────────────────────────────────────────────────────────────────

export async function searchTransactions(
  prisma: PrismaClient,
  userId: string,
  filters: TransactionSearchFilters,
): Promise<TransactionSearchResult[]> {
  const where: Prisma.TransactionWhereInput = { userId }

  if (filters.merchantName) {
    where.OR = [
      { merchantName: { contains: filters.merchantName, mode: 'insensitive' } },
      { merchantNameClean: { contains: filters.merchantName, mode: 'insensitive' } },
      { cleanDescription: { contains: filters.merchantName, mode: 'insensitive' } },
    ]
  }

  if (filters.category) {
    where.category = { contains: filters.category, mode: 'insensitive' }
  }

  if (filters.from || filters.to) {
    where.transactionDate = {}
    if (filters.from) where.transactionDate.gte = filters.from
    if (filters.to) where.transactionDate.lte = filters.to
  }

  if (filters.amountGte !== undefined || filters.amountLte !== undefined) {
    // amount is negative for debits; use absolute value via AND condition
    const amtConditions: Prisma.TransactionWhereInput[] = []
    if (filters.amountGte !== undefined) {
      amtConditions.push({ amount: { lte: -filters.amountGte } })  // debit: -£60 ≤ -£50
    }
    if (filters.amountLte !== undefined) {
      amtConditions.push({ amount: { gte: -filters.amountLte } })   // debit: -£40 ≥ -£50
    }
    if (amtConditions.length > 0) {
      where.AND = amtConditions
    }
  }

  if (filters.isRefund !== undefined) where.isRefund = filters.isRefund
  if (filters.isSalary !== undefined) where.isSalary = filters.isSalary

  const rows = await prisma.transaction.findMany({
    where,
    orderBy: { transactionDate: 'desc' },
    take: filters.limit ?? 10,
    select: {
      id: true,
      transactionDate: true,
      merchantNameClean: true,
      merchantName: true,
      category: true,
      amount: true,
      cleanDescription: true,
      rawDescription: true,
    },
  })

  return rows.map(r => ({
    id: r.id,
    date: r.transactionDate,
    merchant: r.merchantNameClean ?? r.merchantName ?? null,
    category: r.category ?? null,
    amount: Number(r.amount),
    description: r.cleanDescription ?? r.rawDescription ?? null,
  }))
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmtAmt = (n: number): string => {
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  return `${sign}£${abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const fmtDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function formatTransactionSearch(
  results: TransactionSearchResult[],
  filters: TransactionSearchFilters,
): string {
  if (results.length === 0) {
    let out = `No transactions found`
    if (filters.merchantName) out += ` at *${filters.merchantName}*`
    if (filters.from) out += ` from ${fmtDate(filters.from)}`
    out += `.`
    return out
  }

  const total = results.reduce((s, r) => s + r.amount, 0)
  const MAX_ROWS = 15
  let out = `🔍 *Found ${results.length} transaction${results.length === 1 ? '' : 's'}*`
  if (filters.merchantName) out += ` at *${filters.merchantName}*`
  out += `:\n\n`

  // Long lists: show the most recent MAX_ROWS, then summarise the rest.
  const shown = results.slice(0, MAX_ROWS)
  for (const r of shown) {
    const label = r.merchant ?? r.description ?? r.category ?? 'Unknown'
    out += `• ${fmtDate(r.date)} — ${label}: *${fmtAmt(r.amount)}*\n`
  }
  if (results.length > MAX_ROWS) {
    out += `…and ${results.length - MAX_ROWS} more.\n`
  }

  if (results.length > 1) {
    out += `\n*Total: ${fmtAmt(total)}* across ${results.length} payment${results.length === 1 ? '' : 's'}`
  }

  return out.trim()
}
