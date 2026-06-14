import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

// ── Public result types ────────────────────────────────────────────────────

export interface CategorySpend {
  category: string
  total: number           // GBP, positive
  transactionCount: number
}

export interface FinancialSnapshot {
  currentBalances: AccountBalance[]
  totalBalance: number
  monthlyIncome: number
  thisMonthSpend: number
  lastMonthSpend: number
  topCategories: CategorySpend[]
  subscriptions: Subscription[]
  totalSubscriptions: number
  recentTransactions: RecentTransaction[]
  savingsRate: number | null
}

export interface RecentTransaction {
  date: string
  merchant: string
  amount: number
  category: string | null
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

export interface AffordabilityProfile {
  monthlyIncome: number
  monthlyEssentials: number       // rent, utilities, groceries, transport
  monthlySubscriptions: number
  monthlyDiscretionary: number    // everything else
  totalMonthlyCommitted: number   // essentials + subscriptions
  disposableIncome: number        // income - committed
  savingsRate: number | null      // % of income saved (if detectable)
  currentBalance: number          // sum of current account balances
}

export interface SafeToSpend {
  currentBalance: number
  committedThisPeriod: number     // bills/DDs due before end of period
  safeAmount: number
  periodLabel: string
  warningFlags: string[]
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
   * Spending by a specific merchant name (case-insensitive contains).
   */
  async getSpendingByMerchantName(
    userId: string,
    merchantName: string,
    from: Date,
    to: Date,
  ): Promise<{ total: number; transactionCount: number; transactions: RecentTransaction[] }> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        transactionDate: { gte: from, lte: to },
        amount: { lt: 0 },
        merchantName: { contains: merchantName, mode: 'insensitive' },
      },
      orderBy: { transactionDate: 'desc' },
      take: 20,
      select: { merchantName: true, amount: true, transactionDate: true, category: true },
    })
    const total = rows.reduce((s, r) => s + Math.abs(r.amount.toNumber()), 0)
    return {
      total,
      transactionCount: rows.length,
      transactions: rows.map(r => ({
        date: r.transactionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        merchant: r.merchantName ?? merchantName,
        amount: Math.abs(r.amount.toNumber()),
        category: r.category,
      })),
    }
  }

  /**
   * Builds a full financial snapshot for conversational AI responses.
   * Used when no structured template fits — gives Claude everything it needs.
   */
  async getFinancialSnapshot(userId: string): Promise<FinancialSnapshot> {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)

    const [balances, thisMonthAgg, lastMonthAgg, topCats, subs, incomeAgg, recentTxns] = await Promise.all([
      this.getAccountBalances(userId),
      this.prisma.transaction.aggregate({
        where: { userId, transactionDate: { gte: monthStart }, amount: { lt: 0 }, isSalary: false },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, transactionDate: { gte: lastMonthStart, lte: lastMonthEnd }, amount: { lt: 0 }, isSalary: false },
        _sum: { amount: true },
      }),
      this.getSpendingByCategory(userId, monthStart, now),
      this.getSubscriptions(userId),
      this.prisma.transaction.aggregate({
        where: { userId, transactionDate: { gte: threeMonthsAgo }, amount: { gt: 0 }, isSalary: true },
        _sum: { amount: true },
      }),
      this.prisma.transaction.findMany({
        where: { userId, transactionDate: { gte: new Date(now.getTime() - 7 * 86_400_000) }, amount: { lt: 0 } },
        orderBy: { transactionDate: 'desc' },
        take: 10,
        select: { merchantName: true, amount: true, transactionDate: true, category: true },
      }),
    ])

    const totalBalance = balances.reduce((s, b) => s + b.currentBalance, 0)
    const thisMonthSpend = Math.abs((thisMonthAgg._sum.amount ?? new Decimal(0)).toNumber())
    const lastMonthSpend = Math.abs((lastMonthAgg._sum.amount ?? new Decimal(0)).toNumber())
    const monthlyIncome = Math.abs((incomeAgg._sum.amount ?? new Decimal(0)).toNumber()) / 3
    const totalSubscriptions = subs.reduce((s, sub) => s + sub.monthlyAmount, 0)
    const savingsRate = monthlyIncome > 0
      ? Math.max(0, (monthlyIncome - thisMonthSpend) / monthlyIncome * 100)
      : null

    return {
      currentBalances: balances,
      totalBalance,
      monthlyIncome,
      thisMonthSpend,
      lastMonthSpend,
      topCategories: topCats.slice(0, 6),
      subscriptions: subs,
      totalSubscriptions,
      recentTransactions: recentTxns.map(t => ({
        date: t.transactionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        merchant: t.merchantName ?? 'Unknown',
        amount: Math.abs(t.amount.toNumber()),
        category: t.category,
      })),
      savingsRate,
    }
  }

  /**
   * Builds a financial profile for affordability analysis.
   * Uses the last 3 months of transactions for stable averages.
   */
  async getAffordabilityProfile(userId: string): Promise<AffordabilityProfile> {
    const now = new Date()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)

    const ESSENTIAL_CATEGORIES = ['rent', 'mortgage', 'utilities', 'groceries', 'transport', 'insurance', 'council_tax']

    const [incomeAgg, essentialsAgg, subsAgg, allSpendAgg, accounts] = await Promise.all([
      // Income: positive transactions flagged as salary or large credits
      this.prisma.transaction.aggregate({
        where: { userId, transactionDate: { gte: threeMonthsAgo }, amount: { gt: 0 }, isSalary: true },
        _sum: { amount: true },
      }),
      // Essentials
      this.prisma.transaction.aggregate({
        where: {
          userId,
          transactionDate: { gte: threeMonthsAgo },
          amount: { lt: 0 },
          isSalary: false,
          category: { in: ESSENTIAL_CATEGORIES },
        },
        _sum: { amount: true },
      }),
      // Subscriptions
      this.prisma.transaction.aggregate({
        where: { userId, transactionDate: { gte: threeMonthsAgo }, amount: { lt: 0 }, isSubscription: true },
        _sum: { amount: true },
      }),
      // All spend
      this.prisma.transaction.aggregate({
        where: { userId, transactionDate: { gte: threeMonthsAgo }, amount: { lt: 0 }, isSalary: false },
        _sum: { amount: true },
      }),
      this.prisma.account.findMany({
        where: { userId, isActive: true },
        select: { currentBalance: true, accountType: true },
      }),
    ])

    const monthlyIncome = Math.abs((incomeAgg._sum.amount ?? new Decimal(0)).toNumber()) / 3
    const monthlyEssentials = Math.abs((essentialsAgg._sum.amount ?? new Decimal(0)).toNumber()) / 3
    const monthlySubscriptions = Math.abs((subsAgg._sum.amount ?? new Decimal(0)).toNumber()) / 3
    const monthlyTotal = Math.abs((allSpendAgg._sum.amount ?? new Decimal(0)).toNumber()) / 3
    const monthlyDiscretionary = Math.max(0, monthlyTotal - monthlyEssentials - monthlySubscriptions)
    const totalMonthlyCommitted = monthlyEssentials + monthlySubscriptions
    const disposableIncome = monthlyIncome > 0 ? monthlyIncome - totalMonthlyCommitted : 0
    const currentBalance = accounts
      .filter(a => a.accountType !== 'savings')
      .reduce((s, a) => s + (a.currentBalance ?? new Decimal(0)).toNumber(), 0)
    const savingsRate = monthlyIncome > 0
      ? Math.max(0, (monthlyIncome - monthlyTotal) / monthlyIncome * 100)
      : null

    return {
      monthlyIncome,
      monthlyEssentials,
      monthlySubscriptions,
      monthlyDiscretionary,
      totalMonthlyCommitted,
      disposableIncome,
      savingsRate,
      currentBalance,
    }
  }

  /**
   * Calculates how much is safe to spend in a short period (weekend/week).
   * Deducts upcoming committed payments (DDs, subscriptions) from balance.
   */
  async getSafeToSpend(userId: string, days: number): Promise<SafeToSpend> {
    const now = new Date()
    const periodLabel = days <= 2 ? 'this weekend' : days <= 7 ? 'this week' : `the next ${days} days`

    // Current balances (current accounts only, not savings)
    const accounts = await this.prisma.account.findMany({
      where: { userId, isActive: true, accountType: { not: 'savings' } },
      select: { currentBalance: true, availableBalance: true },
    })
    const currentBalance = accounts.reduce(
      (s, a) => s + ((a.availableBalance ?? a.currentBalance ?? new Decimal(0)).toNumber()),
      0,
    )

    // Subscriptions and recurring debits that typically fall in this window
    // Use historical same-day-of-month transactions as proxy for upcoming DDs
    const upcomingDays = Array.from({ length: days }, (_, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() + i + 1)
      return d.getDate()
    })

    const historicalRecurring = await this.prisma.transaction.findMany({
      where: {
        userId,
        isSubscription: true,
        amount: { lt: 0 },
        transactionDate: { gte: new Date(now.getFullYear(), now.getMonth() - 3, 1) },
      },
      select: { amount: true, merchantName: true, transactionDate: true, subscriptionName: true },
    })

    // Find recurring payments whose typical day-of-month falls in our window
    const upcomingCommitted: number[] = []
    const seen = new Set<string>()
    for (const t of historicalRecurring) {
      const dom = t.transactionDate.getDate()
      const key = t.subscriptionName ?? t.merchantName ?? 'unknown'
      if (upcomingDays.includes(dom) && !seen.has(key)) {
        seen.add(key)
        upcomingCommitted.push(Math.abs(t.amount.toNumber()))
      }
    }

    const committedThisPeriod = upcomingCommitted.reduce((s, a) => s + a, 0)
    const safeAmount = Math.max(0, currentBalance - committedThisPeriod - 50) // £50 buffer

    const warningFlags: string[] = []
    if (currentBalance < 200) warningFlags.push('Your balance is low')
    if (committedThisPeriod > 0) warningFlags.push(`£${committedThisPeriod.toFixed(0)} in bills due soon`)
    if (safeAmount < 50) warningFlags.push('Very little available after commitments')

    return { currentBalance, committedThisPeriod, safeAmount, periodLabel, warningFlags }
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
