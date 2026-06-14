/**
 * Anomaly scoring service.
 *
 * Computes a 0.0–1.0 anomaly score for transactions using heuristic rules.
 * The final score is the maximum of all applicable rule scores.
 *
 * Rules:
 *   - Duplicate charge (same merchant, same amount, within 5 days) → 0.9
 *   - Large deviation (> 3×/5×/10× merchant average) → 0.7/0.8/0.85
 *   - New subscription (isSubscription=true, no prior transactions for merchant) → 0.8
 *   - Unusual hour (02:00–05:00 UK time, non-travel merchant) → 0.5
 *   - Large round debit (divisible by 50, > £500, < 3 prior transactions) → 0.6
 */
import type { PrismaClient } from '@prisma/client'
import { logger } from '../../logger.js'

export interface ScoredTransaction {
  id: string
  anomalyScore: number
  reasons: string[]
}

// Travel-related merchant category keywords
const TRAVEL_MERCHANT_CATEGORIES = new Set([
  'airlines',
  'travel',
  'hotel',
  'lodging',
  'car_rental',
  'taxi',
  'transport',
  'transit',
  'railway',
  'ferry',
  'cruise',
])

function isTravelCategory(category: string | null | undefined): boolean {
  if (!category) return false
  const lower = category.toLowerCase()
  for (const cat of TRAVEL_MERCHANT_CATEGORIES) {
    if (lower.includes(cat)) return true
  }
  return false
}

interface TransactionRecord {
  id: string
  userId: string
  amount: number // already converted to number
  merchantName: string | null
  merchantNameClean: string | null
  merchantCategory: string | null
  isSubscription: boolean
  transactionDate: Date
}

interface MerchantHistory {
  count: number
  avgAmount: number // absolute value
}

export interface UserTransactionHistory {
  /** Map of merchant key → history */
  merchants: Map<string, MerchantHistory>
  /** Set of merchant keys that have been seen as subscription before */
  subscriptionMerchants: Set<string>
}

function merchantKey(tx: { merchantNameClean: string | null; merchantName: string | null }): string {
  return (tx.merchantNameClean ?? tx.merchantName ?? '__unknown__').toLowerCase().trim()
}

export function scoreTransaction(
  tx: TransactionRecord,
  history: UserTransactionHistory,
  allRecentTransactions: TransactionRecord[],
): ScoredTransaction {
  const scores: number[] = []
  const reasons: string[] = []
  const key = merchantKey(tx)
  const merchantHist = history.merchants.get(key)
  const absAmount = Math.abs(tx.amount)

  // 1. Duplicate charge: same merchant, same amount, within 5 days
  const fiveDaysMs = 5 * 86_400_000
  const isDuplicate = allRecentTransactions.some(
    (other) =>
      other.id !== tx.id &&
      merchantKey(other) === key &&
      Math.abs(other.amount - tx.amount) < 0.001 &&
      Math.abs(other.transactionDate.getTime() - tx.transactionDate.getTime()) <= fiveDaysMs,
  )
  if (isDuplicate) {
    scores.push(0.9)
    reasons.push('duplicate_charge')
  }

  // 2. Large deviation from merchant average
  if (merchantHist && merchantHist.count >= 3 && merchantHist.avgAmount > 0 && tx.amount < 0) {
    const ratio = absAmount / merchantHist.avgAmount
    if (ratio > 10) {
      scores.push(0.85)
      reasons.push('large_deviation_10x')
    } else if (ratio > 5) {
      scores.push(0.8)
      reasons.push('large_deviation_5x')
    } else if (ratio > 3) {
      scores.push(0.7)
      reasons.push('large_deviation_3x')
    }
  }

  // 3. New subscription: isSubscription but no prior transactions for merchant
  if (tx.isSubscription && (!merchantHist || merchantHist.count === 0)) {
    scores.push(0.8)
    reasons.push('new_subscription')
  }

  // 4. Unusual hour: 02:00–05:00 UK time, non-travel merchant
  if (!isTravelCategory(tx.merchantCategory)) {
    const hourStr = new Date(tx.transactionDate).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      hour12: false,
    })
    const hour = parseInt(hourStr, 10)
    if (hour >= 2 && hour < 5) {
      scores.push(0.5)
      reasons.push('unusual_hour')
    }
  }

  // 5. Large round debit: divisible by 50, > £500, < 3 prior transactions
  if (
    tx.amount < 0 &&
    absAmount > 500 &&
    absAmount % 50 === 0 &&
    (!merchantHist || merchantHist.count < 3)
  ) {
    scores.push(0.6)
    reasons.push('large_round_debit')
  }

  const anomalyScore = scores.length > 0 ? Math.max(...scores) : 0

  return { id: tx.id, anomalyScore, reasons }
}

export async function runAnomalyScoreBatch(
  prisma: PrismaClient,
  userId?: string,
): Promise<{ scored: number; errors: number }> {
  const cutoff = new Date(Date.now() - 48 * 3_600_000)

  // Find transactions needing scoring
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawTxs = await (prisma.transaction.findMany as any)({
    where: {
      ...(userId ? { userId } : {}),
      createdAt: { gte: cutoff },
      anomalyScore: null,
    },
    select: {
      id: true,
      userId: true,
      amount: true,
      merchantName: true,
      merchantNameClean: true,
      merchantCategoryCode: true,
      isSubscription: true,
      transactionDate: true,
    },
    orderBy: { transactionDate: 'asc' },
  })

  if (rawTxs.length === 0) return { scored: 0, errors: 0 }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txs: TransactionRecord[] = (rawTxs as any[]).map((t) => ({
    id: t.id,
    userId: t.userId,
    amount: Number(t.amount),
    merchantName: t.merchantName,
    merchantNameClean: t.merchantNameClean,
    merchantCategory: t.merchantCategoryCode ?? null,
    isSubscription: t.isSubscription,
    transactionDate: new Date(t.transactionDate),
  }))

  // Group by userId
  const byUser = new Map<string, TransactionRecord[]>()
  for (const tx of txs) {
    const list = byUser.get(tx.userId) ?? []
    list.push(tx)
    byUser.set(tx.userId, list)
  }

  let scored = 0
  let errors = 0

  for (const [uid, userTxs] of byUser) {
    try {
      // Build history from all historical transactions for this user (before 48h window)
      const historicalRaw = await prisma.transaction.findMany({
        where: {
          userId: uid,
          transactionDate: { lt: cutoff },
          amount: { lt: 0 },
        },
        select: {
          amount: true,
          merchantName: true,
          merchantNameClean: true,
          isSubscription: true,
        },
      })

      const history: UserTransactionHistory = {
        merchants: new Map(),
        subscriptionMerchants: new Set(),
      }

      for (const h of historicalRaw) {
        const key = merchantKey(h)
        const absAmt = Math.abs(Number(h.amount))
        const existing = history.merchants.get(key)
        if (existing) {
          existing.avgAmount = (existing.avgAmount * existing.count + absAmt) / (existing.count + 1)
          existing.count++
        } else {
          history.merchants.set(key, { count: 1, avgAmount: absAmt })
        }
        if (h.isSubscription) {
          history.subscriptionMerchants.add(key)
        }
      }

      // Score each transaction
      const updates: Array<{ id: string; score: number }> = []
      for (const tx of userTxs) {
        try {
          const result = scoreTransaction(tx, history, userTxs)
          updates.push({ id: tx.id, score: result.anomalyScore })
          logger.debug({ txId: tx.id, score: result.anomalyScore, reasons: result.reasons }, 'Anomaly score computed')
        } catch (err) {
          errors++
          logger.error({ err, txId: tx.id }, 'Failed to score transaction')
        }
      }

      // Bulk update
      await Promise.all(
        updates.map(({ id, score }) =>
          prisma.transaction.update({
            where: { id },
            data: { anomalyScore: score },
          }),
        ),
      )

      scored += updates.length
    } catch (err) {
      errors += userTxs.length
      logger.error({ err, userId: uid }, 'Failed to process user transactions for anomaly scoring')
    }
  }

  logger.info({ scored, errors }, 'Anomaly score batch complete')
  return { scored, errors }
}
