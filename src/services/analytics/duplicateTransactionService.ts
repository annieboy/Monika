/**
 * Duplicate transaction detection.
 *
 * Finds likely duplicate charges: transactions from the same merchant
 * with identical or near-identical amounts occurring within 24 hours.
 *
 * A pair is flagged as a potential duplicate when:
 *   - Same cleaned merchant name (case-insensitive)
 *   - Amounts match within ±1% (to handle minor currency conversion noise)
 *   - Both are debits (amount < 0)
 *   - Transactions are within 24 hours of each other
 *
 * Returns groups — each group has 2+ transactions that look like duplicates.
 */
import type { PrismaClient } from '@prisma/client'

export interface DuplicateGroup {
  merchant: string
  amount: number        // absolute value
  transactions: Array<{
    id: string
    date: Date
    description: string | null
  }>
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const AMOUNT_TOLERANCE = 0.01   // 1%

export async function detectDuplicateTransactions(
  prisma: PrismaClient,
  userId: string,
  lookbackDays = 30,
): Promise<DuplicateGroup[]> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000)

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      transactionDate: { gte: since },
      amount: { lt: 0 },
      OR: [
        { merchantNameClean: { not: null } },
        { merchantName: { not: null } },
      ],
    },
    orderBy: [
      { merchantNameClean: 'asc' },
      { transactionDate: 'asc' },
    ],
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

  // Group by merchant name
  const byMerchant = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = (row.merchantNameClean ?? row.merchantName ?? '').toLowerCase().trim()
    if (!key) continue
    const existing = byMerchant.get(key) ?? []
    existing.push(row)
    byMerchant.set(key, existing)
  }

  const groups: DuplicateGroup[] = []

  for (const [merchantKey, txns] of byMerchant) {
    if (txns.length < 2) continue

    // Sort by date ascending (already done by query but defensive)
    const sorted = [...txns].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime())

    const visited = new Set<string>()

    for (let i = 0; i < sorted.length; i++) {
      const base = sorted[i]!
      if (visited.has(base.id)) continue

      const duplicates = [base]

      for (let j = i + 1; j < sorted.length; j++) {
        const candidate = sorted[j]!
        if (visited.has(candidate.id)) continue

        const timeDiff = candidate.transactionDate.getTime() - base.transactionDate.getTime()
        if (timeDiff > TWENTY_FOUR_HOURS_MS) break  // sorted so we can early-exit

        const baseAmt = Math.abs(Number(base.amount))
        const candidateAmt = Math.abs(Number(candidate.amount))
        const tolerance = baseAmt * AMOUNT_TOLERANCE
        if (Math.abs(baseAmt - candidateAmt) <= tolerance) {
          duplicates.push(candidate)
        }
      }

      if (duplicates.length >= 2) {
        for (const d of duplicates) visited.add(d.id)
        groups.push({
          merchant: txns[0]?.merchantNameClean ?? txns[0]?.merchantName ?? merchantKey,
          amount: Math.abs(Number(base.amount)),
          transactions: duplicates.map(d => ({
            id: d.id,
            date: d.transactionDate,
            description: d.cleanDescription ?? d.rawDescription ?? null,
          })),
        })
      }
    }
  }

  return groups
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function formatDuplicateTransactions(groups: DuplicateGroup[]): string {
  if (groups.length === 0) {
    return `✅ No potential duplicate transactions found in the last 30 days.`
  }

  let out = `⚠️ *${groups.length} potential duplicate charge${groups.length === 1 ? '' : 's'} detected*\n\n`

  for (const group of groups) {
    out += `*${group.merchant}* — ${fmt(group.amount)} each:\n`
    for (const tx of group.transactions) {
      out += `  • ${fmtDate(tx.date)}\n`
    }
    out += `\n`
  }

  out += `_If you were charged twice in error, contact the merchant or your bank to request a refund._`

  return out.trim()
}
