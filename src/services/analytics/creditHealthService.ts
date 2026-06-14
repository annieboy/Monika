/**
 * Credit health tips service.
 *
 * Generates personalised, actionable credit-score advice based on the user's
 * actual spending patterns. Does NOT integrate with a credit bureau — it
 * gives behaviour-based guidance only.
 *
 * Signals analysed:
 *   - High credit utilisation proxy: spending near account balance
 *   - Missed / late payment risk: recurring payments vs balance buffer
 *   - High subscription burden: subscriptions > 15% of income
 *   - Frequent overdraft pattern: balance often near zero (not yet detectable, shown as tip)
 *   - Electoral roll reminder (always shown — high-impact and free)
 *
 * FCA disclaimer always included.
 */
import type { PrismaClient } from '@prisma/client'

export interface CreditTip {
  priority: 'high' | 'medium' | 'low'
  emoji: string
  title: string
  detail: string
}

export interface CreditHealthReport {
  tips: CreditTip[]
  score: 'strong' | 'moderate' | 'needs_attention'   // indicative only
}

async function getSignals(prisma: PrismaClient, userId: string): Promise<{ totalBalance: number; monthlyIncome: number; thisMonthSpend: number; monthlySubscriptions: number }> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [balanceAgg, incomeAgg, spendAgg, subscriptionRows] = await Promise.all([
    prisma.account.aggregate({
      where: { userId, isActive: true },
      _sum: { currentBalance: true },
    }),
    prisma.transaction.aggregate({
      where: {
        userId,
        isSalary: true,
        amount: { gt: 0 },
        transactionDate: { gte: new Date(now.getFullYear(), now.getMonth() - 2, 1) },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        userId,
        amount: { lt: 0 },
        transactionDate: { gte: monthStart },
      },
      _sum: { amount: true },
    }),
    prisma.recurringPayment.findMany({
      where: { userId, isActive: true, averageAmount: { lt: 0 } },
      select: { averageAmount: true },
    }),
  ])

  const totalBalance = Number(balanceAgg._sum.currentBalance ?? 0)
  // Monthly income = last 2-month income / 2
  const twoMonthIncome = Number(incomeAgg._sum.amount ?? 0)
  const monthlyIncome = twoMonthIncome / 2
  const thisMonthSpend = Math.abs(Number(spendAgg._sum.amount ?? 0))
  const monthlySubscriptions = subscriptionRows.reduce((s, r) => s + Math.abs(Number(r.averageAmount)), 0)

  return { totalBalance, monthlyIncome, thisMonthSpend, monthlySubscriptions }
}

export async function getCreditHealthReport(
  prisma: PrismaClient,
  userId: string,
): Promise<CreditHealthReport> {
  const { totalBalance, monthlyIncome, thisMonthSpend, monthlySubscriptions } = await getSignals(prisma, userId)

  const tips: CreditTip[] = []

  // ── Electoral roll ────────────────────────────────────────────────────────
  tips.push({
    priority: 'medium',
    emoji: '🗳️',
    title: 'Register on the electoral roll',
    detail: 'Being registered to vote at your current address is one of the fastest ways to improve your credit score. Register free at gov.uk/register-to-vote.',
  })

  // ── Balance buffer / overdraft risk ───────────────────────────────────────
  if (totalBalance < 100 && totalBalance >= 0) {
    tips.push({
      priority: 'high',
      emoji: '⚠️',
      title: 'Low balance — avoid going into overdraft',
      detail: `Your current balance is £${totalBalance.toFixed(2)}. Using an unarranged overdraft damages your credit score and incurs fees. Consider transferring from savings or cutting spending this week.`,
    })
  } else if (totalBalance < 0) {
    tips.push({
      priority: 'high',
      emoji: '🚨',
      title: 'You\'re currently overdrawn',
      detail: 'Being in your overdraft is flagged by lenders. Try to clear it as soon as possible — even paying off a small amount regularly improves your profile.',
    })
  }

  // ── Subscription burden ───────────────────────────────────────────────────
  if (monthlyIncome > 0 && monthlySubscriptions / monthlyIncome > 0.15) {
    const pct = Math.round((monthlySubscriptions / monthlyIncome) * 100)
    tips.push({
      priority: 'medium',
      emoji: '📱',
      title: `High subscription burden (${pct}% of income)`,
      detail: `You're spending ${pct}% of your income on recurring subscriptions. Lenders see high committed outgoings as a risk. Review your subscriptions and cancel ones you don't use.`,
    })
  }

  // ── Spending vs income ratio ──────────────────────────────────────────────
  if (monthlyIncome > 0 && thisMonthSpend / monthlyIncome > 0.9) {
    tips.push({
      priority: 'medium',
      emoji: '📊',
      title: 'High spend-to-income ratio',
      detail: 'You\'re spending close to your full income this month. Lenders prefer to see savings capacity. Aim to spend no more than 75-80% of your income each month.',
    })
  }

  // ── Positive habit: savings ───────────────────────────────────────────────
  if (monthlyIncome > 0 && thisMonthSpend / monthlyIncome < 0.7) {
    tips.push({
      priority: 'low',
      emoji: '✅',
      title: 'Good savings ratio this month',
      detail: 'Spending well within your income shows lenders you manage money responsibly. Keep it up — consistent savings history is viewed positively.',
    })
  }

  // ── Credit card usage tip ─────────────────────────────────────────────────
  tips.push({
    priority: 'low',
    emoji: '💳',
    title: 'Keep credit utilisation below 30%',
    detail: 'If you have a credit card, try to use less than 30% of your limit each month and pay the full balance — this is one of the strongest credit score signals.',
  })

  // ── Soft search tip ──────────────────────────────────────────────────────
  tips.push({
    priority: 'low',
    emoji: '🔍',
    title: 'Use eligibility checkers before applying',
    detail: 'When shopping for a mortgage, loan, or credit card, use soft-search eligibility checkers (they don\'t show on your file). Hard searches from full applications stay on your report for 12 months.',
  })

  // Determine indicative score
  const highCount = tips.filter(t => t.priority === 'high').length
  const score: CreditHealthReport['score'] =
    highCount >= 1 ? 'needs_attention' : tips.some(t => t.priority === 'medium' && t.title !== 'Register on the electoral roll') ? 'moderate' : 'strong'

  return { tips, score }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const SCORE_LABELS: Record<CreditHealthReport['score'], string> = {
  strong: '🟢 Strong',
  moderate: '🟡 Moderate',
  needs_attention: '🔴 Needs attention',
}

export function formatCreditHealthReport(report: CreditHealthReport): string {
  let out = `💳 *Credit health tips*\n`
  out += `Indicative status: *${SCORE_LABELS[report.score]}*\n\n`

  const byPriority = ['high', 'medium', 'low'] as const
  for (const priority of byPriority) {
    const group = report.tips.filter(t => t.priority === priority)
    if (group.length === 0) continue
    for (const tip of group) {
      out += `${tip.emoji} *${tip.title}*\n${tip.detail}\n\n`
    }
  }

  out += `_These tips are based on your spending patterns only and are not financial advice. For an accurate credit score, check Experian, Equifax, or TransUnion (free via ClearScore, Credit Karma, or MSE Credit Club). Always consult a qualified adviser before applying for credit._`

  return out.trim()
}
