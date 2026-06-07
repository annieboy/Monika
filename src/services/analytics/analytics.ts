import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

// ── Public result types ────────────────────────────────────────────────────

export interface CategorySpend {
  category: string
  total: number           // GBP, positive
  transactionCount: number
}

export interface MerchantSpend {
  merchantName: string
  total: number
  transactionCount: number
}

export interface Subscription {
  merchantName: string
  subscriptionName: string | null
  monthlyAmount: number
  lastSeen: Date
}

export interface UnusualTransaction {
  merchantName: string | null
  amount: number          // negative (debit)
  transactionDate: Date
  category: string | null
  reason: string
}

export interface AccountBalance {
  displayName: string | null
  accountType: string
  currentBalance: number
  availableBalance: number | null
}

export interface MonthlyComparison {
  thisMonth: number
  lastMonth: number
  changeAmount: number    // positive = spending more
  changePct: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

// ── Service ────────────────────────────────────────────────────────────────

export class TransactionAnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async hasActiveBankConnection(userId: string): Promise<boolean> {
    const conn = await this.prisma.bankConnection.findFirst({
      where: { userId, consentStatus: 'active' },
      select: { id: true },
    })
    return conn !== null
  }

  /**
   * Spending grouped by category for a date window.
   * Optionally filtered to a single category (case-insensitive substring match).
   */
  async getSpendingByCategory(
    userId: string,
    from: Date,
    to: Date,
    categoryFilter?: string | undefined,
  ): Promise<CategorySpend[]> {
    const results = await this.prisma.transaction.groupBy({
      by: ['category'],
      where: {
        userId,
        transactionDate: { gte: from, lte: to },
        amount: { lt: 0 },
        isSalary: false,
        ...(categoryFilter
          ? { category: { contains: categoryFilter, mode: 'insensitive' } }
          : { category: { not: null } }),
      },
      _sum: { amount: true },
      _count: { id: true },
      orderBy: { _sum: { amount: 'asc' } },  // most negative first = highest spend
    })

    return results
      .filter((r): r is typeof r & { category: string } => r.category !== null)
      .map((r) => ({
        category: r.category,
        total: Math.abs((r._sum.amount ?? new Decimal(0)).toNumber()),
        transactionCount: r._count.id,
      }))
  }

  /**
   * Spending grouped by merchant for a date window.
   */
  async getSpendingByMerchant(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<MerchantSpend[]> {
    const results = await this.prisma.transaction.groupBy({
      by: ['merchantName'],
      where: {
        userId,
        transactionDate: { gte: from, lte: to },
        amount: { lt: 0 },
        isSalary: false,
        merchantName: { not: null },
      },
      _sum: { amount: true },
      _count: { id: true },
      orderBy: { _sum: { amount: 'asc' } },
    })

    return results
      .filter((r): r is typeof r & { merchantName: string } => r.merchantName !== null)
      .map((r) => ({
        merchantName: r.merchantName,
        total: Math.abs((r._sum.amount ?? new Decimal(0)).toNumber()),
        transactionCount: r._count.id,
      }))
  }

  /**
   * This-month vs last-month spending comparison, optionally for one category.
   */
  async getMonthlyComparison(
    userId: string,
    categoryFilter?: string | undefined,
  ): Promise<MonthlyComparison> {
    const now = new Date()
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const baseWhere = {
      isSalary: false,
      amount: { lt: 0 },
      ...(categoryFilter
        ? { category: { contains: categoryFilter, mode: 'insensitive' as const } }
        : {}),
    }

    const [thisMonthAgg, lastMonthAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { userId, transactionDate: { gte: startOfMonth(now) }, ...baseWhere },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId,
          transactionDate: { gte: startOfMonth(lastMonthDate), lte: endOfMonth(lastMonthDate) },
          ...baseWhere,
        },
        _sum: { amount: true },
      }),
    ])

    const thisMonth = Math.abs((thisMonthAgg._sum.amount ?? new Decimal(0)).toNumber())
    const lastMonth = Math.abs((lastMonthAgg._sum.amount ?? new Decimal(0)).toNumber())
    const changeAmount = thisMonth - lastMonth
    const changePct = lastMonth > 0 ? (changeAmount / lastMonth) * 100 : null

    return { thisMonth, lastMonth, changeAmount, changePct }
  }

  /**
   * Active subscriptions: one row per distinct subscription name, most recently seen.
   */
  async getSubscriptions(userId: string): Promise<Subscription[]> {
    // findMany with distinct to get the latest transaction per subscriptionName
    const rows = await this.prisma.transaction.findMany({
      where: { userId, isSubscription: true, amount: { lt: 0 } },
      orderBy: { transactionDate: 'desc' },
      distinct: ['subscriptionName'],
      select: {
        subscriptionName: true,
        merchantName: true,
        amount: true,
        transactionDate: true,
      },
    })

    return rows.map((r) => ({
      merchantName: r.merchantName ?? r.subscriptionName ?? 'Unknown',
      subscriptionName: r.subscriptionName,
      monthlyAmount: Math.abs(r.amount.toNumber()),
      lastSeen: r.transactionDate,
    }))
  }

  /**
   * Unusual spending detection using two deterministic rules:
   *
   * Rule 1 — Large single debit: abs(amount) > LARGE_THRESHOLD (£150), excluding
   *           rent which is an expected fixed cost.
   *
   * Rule 2 — Statistical outlier: transaction amount > mean + 2σ for its
   *           category within the same window (requires ≥ 4 data points).
   */
  async getUnusualSpending(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<UnusualTransaction[]> {
    const LARGE_THRESHOLD = 150

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        transactionDate: { gte: from, lte: to },
        amount: { lt: 0 },
        isSalary: false,
        category: { notIn: ['rent', 'transfer'] },
      },
      orderBy: { amount: 'asc' },
      select: {
        merchantName: true,
        amount: true,
        transactionDate: true,
        category: true,
        rawDescription: true,
        providerTransactionId: true,
      },
    })

    const flagged = new Map<string, UnusualTransaction>()

    // Rule 1: large individual transactions
    for (const t of transactions) {
      const abs = Math.abs(t.amount.toNumber())
      if (abs >= LARGE_THRESHOLD) {
        flagged.set(t.providerTransactionId, {
          merchantName: t.merchantName,
          amount: t.amount.toNumber(),
          transactionDate: t.transactionDate,
          category: t.category,
          reason: `Large transaction (£${abs.toFixed(2)})`,
        })
      }
    }

    // Rule 2: statistical outliers per category
    const byCategory = new Map<string, typeof transactions>()
    for (const t of transactions) {
      if (!t.category) continue
      const bucket = byCategory.get(t.category) ?? []
      bucket.push(t)
      byCategory.set(t.category, bucket)
    }

    for (const [, bucket] of byCategory) {
      if (bucket.length < 4) continue
      const amounts = bucket.map((t) => Math.abs(t.amount.toNumber()))
      const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
      const variance = amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length
      const stdDev = Math.sqrt(variance)
      const threshold = mean + 2 * stdDev

      for (const t of bucket) {
        const abs = Math.abs(t.amount.toNumber())
        if (abs > threshold && !flagged.has(t.providerTransactionId)) {
          flagged.set(t.providerTransactionId, {
            merchantName: t.merchantName,
            amount: t.amount.toNumber(),
            transactionDate: t.transactionDate,
            category: t.category,
            reason: `Above typical ${t.category} spend (avg £${mean.toFixed(0)}, this £${abs.toFixed(0)})`,
          })
        }
      }
    }

    return Array.from(flagged.values()).sort((a, b) => a.amount - b.amount) // most negative first
  }

  /**
   * Current balances for all active accounts.
   */
  async getAccountBalances(userId: string): Promise<AccountBalance[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId, isActive: true },
      select: {
        displayName: true,
        accountType: true,
        currentBalance: true,
        availableBalance: true,
        isPrimary: true,
      },
      orderBy: { isPrimary: 'desc' },
    })

    return accounts.map((a) => ({
      displayName: a.displayName,
      accountType: a.accountType,
      currentBalance: (a.currentBalance ?? new Decimal(0)).toNumber(),
      availableBalance: a.availableBalance?.toNumber() ?? null,
    }))
  }
}
