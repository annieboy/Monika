/**
 * Detects recurring payments from a user's transaction history.
 *
 * Algorithm:
 *   1. Fetch 6 months of outgoing transactions
 *   2. Group by normalised merchant slug
 *   3. For each group with ≥2 transactions, compute cadence and amount stats
 *   4. Discard high-variance amounts (one-off purchases, not subscriptions)
 *   5. Upsert into recurring_payments table
 *
 * Cadence detection allows ±5 day variance to handle billing date drift.
 * Confidence decays as variance increases.
 */
import type { PrismaClient, Transaction } from '@prisma/client'
import { detectProviderSlug, slugifyMerchant, PROVIDER_CATEGORY_MAP } from './merchantMappings.js'

export interface CadenceResult {
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'irregular'
  cadenceConfidence: number // 0–1
}

export interface AmountStats {
  averageAmount: number
  minAmount: number
  maxAmount: number
  stdDev: number
}

const KNOWN_CADENCES = [
  { label: 'weekly' as const,    days: 7 },
  { label: 'monthly' as const,   days: 30 },
  { label: 'quarterly' as const, days: 91 },
  { label: 'annual' as const,    days: 365 },
]

const CADENCE_VARIANCE_DAYS = 5
const MIN_OCCURRENCES = 2
const MAX_AMOUNT_VARIANCE_RATIO = 0.20 // >20% stdDev/mean = not a subscription
const LOOKBACK_MONTHS = 6

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 86_400_000
}

export function detectCadence(dates: Date[]): CadenceResult {
  if (dates.length < 2) return { cadence: 'irregular', cadenceConfidence: 0 }

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (prev && curr) gaps.push(daysBetween(prev, curr))
  }

  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length
  const stdDev = Math.sqrt(variance)

  for (const c of KNOWN_CADENCES) {
    if (Math.abs(mean - c.days) <= CADENCE_VARIANCE_DAYS) {
      const confidence = Math.max(0, 1 - stdDev / c.days)
      return { cadence: c.label, cadenceConfidence: confidence }
    }
  }

  return { cadence: 'irregular', cadenceConfidence: 0.2 }
}

export function computeAmountStats(amounts: number[]): AmountStats {
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const variance = amounts.reduce((s, a) => s + (a - avg) ** 2, 0) / amounts.length
  return { averageAmount: avg, minAmount: min, maxAmount: max, stdDev: Math.sqrt(variance) }
}

function groupByMerchant(txns: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>()
  for (const t of txns) {
    const raw = t.merchantNameClean ?? t.merchantName ?? t.rawDescription ?? 'unknown'
    const slug = detectProviderSlug(raw) ?? slugifyMerchant(raw)
    const group = map.get(slug) ?? []
    group.push(t)
    map.set(slug, group)
  }
  return map
}

function frequencyFromCadence(
  c: CadenceResult['cadence'],
): 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'irregular' {
  return c
}

export async function detectRecurringPayments(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const since = new Date()
  since.setMonth(since.getMonth() - LOOKBACK_MONTHS)

  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      amount: { lt: 0 }, // outgoing only
      transactionDate: { gte: since },
      status: 'settled',
    },
    orderBy: { transactionDate: 'asc' },
  })

  const grouped = groupByMerchant(txns)
  let upserted = 0

  for (const [merchantSlug, merchantTxns] of grouped) {
    if (merchantTxns.length < MIN_OCCURRENCES) continue

    const amounts = merchantTxns.map(t => Math.abs(Number(t.amount)))
    const stats = computeAmountStats(amounts)

    // Skip high-variance — not a recurring subscription
    if (stats.averageAmount > 0 && stats.stdDev / stats.averageAmount > MAX_AMOUNT_VARIANCE_RATIO) {
      continue
    }

    const dates = merchantTxns.map(t => new Date(t.transactionDate))
    const cadenceResult = detectCadence(dates)

    // Only keep if confidence is meaningful
    if (cadenceResult.cadenceConfidence < 0.5 && cadenceResult.cadence === 'irregular') continue

    const firstTxn = merchantTxns[0]
    const lastTxn = merchantTxns[merchantTxns.length - 1]
    if (!firstTxn || !lastTxn) continue

    const rawName = firstTxn.merchantNameClean ?? firstTxn.merchantName ?? merchantSlug
    const providerSlug = detectProviderSlug(rawName)
    const merchantCategory = providerSlug
      ? (PROVIDER_CATEGORY_MAP[providerSlug] ?? firstTxn.category ?? 'other')
      : (firstTxn.category ?? 'other')

    await prisma.recurringPayment.upsert({
      where: { userId_merchantSlug: { userId, merchantSlug } },
      create: {
        userId,
        merchantName: rawName,
        merchantSlug,
        merchantCategory,
        typicalAmount: stats.averageAmount,
        averageAmount: stats.averageAmount,
        minAmount: stats.minAmount,
        maxAmount: stats.maxAmount,
        amountVariance: stats.stdDev,
        currency: firstTxn.currency,
        frequency: frequencyFromCadence(cadenceResult.cadence),
        cadenceConfidence: cadenceResult.cadenceConfidence,
        firstSeenDate: new Date(firstTxn.transactionDate),
        lastSeenDate: new Date(lastTxn.transactionDate),
        occurrenceCount: merchantTxns.length,
        detectionMethod: 'amount_cluster',
        isActive: true,
        status: 'active',
      },
      update: {
        merchantCategory,
        typicalAmount: stats.averageAmount,
        averageAmount: stats.averageAmount,
        minAmount: stats.minAmount,
        maxAmount: stats.maxAmount,
        amountVariance: stats.stdDev,
        frequency: frequencyFromCadence(cadenceResult.cadence),
        cadenceConfidence: cadenceResult.cadenceConfidence,
        lastSeenDate: new Date(lastTxn.transactionDate),
        occurrenceCount: merchantTxns.length,
        isActive: true,
      },
    })
    upserted++
  }

  return upserted
}
