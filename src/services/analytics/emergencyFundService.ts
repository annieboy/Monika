/**
 * Emergency fund checker.
 *
 * Analyses the user's monthly expenses and current balance to assess
 * emergency fund coverage. Recommends 3-6 months of essential spending
 * as the target (standard UK personal finance guidance).
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Essential spending categories (non-discretionary)
const ESSENTIAL_CATEGORIES = [
  'housing', 'rent', 'mortgage', 'utilities', 'groceries', 'food',
  'transport', 'insurance', 'healthcare', 'bills', 'broadband', 'mobile',
  'childcare', 'education',
]

function isEssentialCategory(category: string): boolean {
  const lower = category.toLowerCase()
  return ESSENTIAL_CATEGORIES.some(c => lower.includes(c))
}

export async function getEmergencyFundStatus(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  // Get recent essential spending
  const spending = await prisma.transaction.groupBy({
    by: ['category'],
    where: {
      userId,
      amount: { gt: 0 }, // outgoings
      transactionDate: { gte: threeMonthsAgo },
    },
    _sum: { amount: true },
  })

  const essentialTotal = spending
    .filter(s => isEssentialCategory(s.category ?? ''))
    .reduce((sum, s) => sum + Number((s._sum as { amount?: unknown }).amount ?? 0), 0)

  const monthlyEssentials = essentialTotal / 3

  // Current liquid balance
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { currentBalance: true, accountType: true },
  })
  const liquidBalance = accounts
    .filter(a => a.accountType !== 'mortgage' && a.accountType !== 'loan')
    .reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0)

  const target3m = monthlyEssentials * 3
  const target6m = monthlyEssentials * 6

  const monthsCovered = monthlyEssentials > 0
    ? Math.min(liquidBalance / monthlyEssentials, 12)
    : 0

  let out = `🛡️ *Emergency fund check*\n\n`

  if (monthlyEssentials === 0) {
    out += `I need a few months of transaction data to estimate your essential expenses. Keep your bank connected and I'll check back.\n\n`
    out += `*Rule of thumb:* aim for 3–6 months of essential expenses in an easy-access account.`
    return out
  }

  out += `*Monthly essentials:* ${fmt(monthlyEssentials)}\n`
  out += `*Current liquid balance:* ${fmt(liquidBalance)}\n`
  out += `*Months covered:* ${monthsCovered.toFixed(1)}\n\n`

  if (monthsCovered >= 6) {
    out += `✅ *Excellent!* You have ${monthsCovered.toFixed(1)} months of essential expenses covered — well above the recommended 3–6 month target.\n\n`
    out += `Your emergency fund is in great shape. Consider putting any surplus into a higher-rate savings account or ISA.`
  } else if (monthsCovered >= 3) {
    const toTarget = target6m - liquidBalance
    out += `✅ *Good* — you have ${monthsCovered.toFixed(1)} months covered, which meets the minimum 3-month recommendation.\n\n`
    out += `To reach the *6-month target* (${fmt(target6m)}), you'd need to save another *${fmt(toTarget)}*.\n`
    const monthsToTarget = toTarget > 0 ? Math.ceil(toTarget / (monthlyEssentials * 0.2)) : 0
    if (monthsToTarget > 0) {
      out += `Saving 20% of essentials/month (${fmt(monthlyEssentials * 0.2)}) gets you there in ~${monthsToTarget} months.`
    }
  } else {
    const gap3m = target3m - liquidBalance
    out += `⚠️ *Action needed* — you currently have ${monthsCovered.toFixed(1)} months covered.\n\n`
    out += `*Minimum target (3 months):* ${fmt(target3m)}\n`
    out += `*Gap to minimum target:* ${fmt(Math.max(0, gap3m))}\n\n`
    out += `Priority: build your emergency fund before investing. Even *${fmt(200)}/month* compounds fast.\n\n`
    out += `Say *"set up an emergency fund goal"* and I'll create a savings tracker for you.`
  }

  return out
}

export function isEmergencyFundRequest(message: string): boolean {
  return /emergency\s+fund|rainy\s+day\s+fund|safety\s+net|how\s+many\s+months.*(?:saving|cover)|(?:cover|afford)\s+\d+\s+months|financial\s+cushion/i.test(message)
}
