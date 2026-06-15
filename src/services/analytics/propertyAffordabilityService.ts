/**
 * Property affordability calculator.
 *
 * Estimates mortgage borrowing capacity and monthly payments based on
 * detected income and UK lender stress-test criteria.
 *
 * Uses standard UK affordability multiples (4.5x income for most lenders,
 * up to 5.5x for higher earners) and the stress-test rate mandated by
 * the FCA / Bank of England (3% above revert rate).
 *
 * FCA mortgage disclaimer always included.
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface AffordabilityResult {
  grossAnnualIncome: number
  maxBorrow4_5x: number
  maxBorrow5_5x: number
  depositAssumed: number
  maxPropertyPrice: number
  monthlyRepayment25yr: number
  monthlyRepayment35yr: number
  stressTestMonthly: number
  debtToIncomeOk: boolean
}

// Monthly mortgage repayment using annuity formula
function monthlyRepayment(principal: number, annualRate: number, years: number): number {
  const r = annualRate / 12
  const n = years * 12
  if (r === 0) return principal / n
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function parseDepositFromMessage(message: string): number | null {
  const match = message.match(/deposit\s+(?:of\s+)?£([\d,]+(?:k)?)/i)
    ?? message.match(/£([\d,]+(?:k)?)\s+deposit/i)
    ?? message.match(/put\s+down\s+£([\d,]+(?:k)?)/i)
  if (!match) return null
  const raw = match[1]!.replace(/,/g, '').replace(/k$/i, '000')
  return parseFloat(raw)
}

export async function calculatePropertyAffordability(
  prisma: PrismaClient,
  userId: string,
  message: string,
): Promise<string> {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  // Detect income from credits
  const credits = await prisma.transaction.findMany({
    where: {
      userId,
      amount: { lt: 0 },
      transactionDate: { gte: threeMonthsAgo },
    },
    select: { amount: true },
  })

  const monthlyIncome = Math.abs(credits.reduce((s, t) => s + Number(t.amount ?? 0), 0)) / 3
  const grossAnnualIncome = monthlyIncome * 12

  if (grossAnnualIncome < 1000) {
    return (
      `To estimate mortgage affordability, I need to see your income in your transactions.\n\n` +
      `Connect your bank (or tell me your salary: *"My salary is £45,000"*) and ask again.`
    )
  }

  const depositFromMessage = parseDepositFromMessage(message)
  // Assume 10% deposit if not specified
  const depositPct = 0.10
  const maxBorrow4_5x = grossAnnualIncome * 4.5
  const maxBorrow5_5x = grossAnnualIncome * 5.5
  const depositAssumed = depositFromMessage ?? maxBorrow4_5x * (depositPct / (1 - depositPct))
  const maxPropertyPrice = maxBorrow4_5x + depositAssumed

  // Current UK rates (representative — 2024/25)
  const currentRate = 0.045  // ~4.5% 5-year fix
  const stressRate = currentRate + 0.03  // stress test at +3%

  const monthlyRepayment25yr = monthlyRepayment(maxBorrow4_5x, currentRate, 25)
  const monthlyRepayment35yr = monthlyRepayment(maxBorrow4_5x, currentRate, 35)
  const stressTestMonthly = monthlyRepayment(maxBorrow4_5x, stressRate, 25)

  // Debt-to-income: repayment should be < 40% of net income (rough heuristic)
  const netMonthlyIncome = monthlyIncome * 0.75  // rough net after tax
  const debtToIncomeOk = monthlyRepayment25yr < netMonthlyIncome * 0.40

  let out = `🏡 *Property affordability estimate*\n\n`
  out += `*Estimated gross income:* ${fmt(grossAnnualIncome)}/year (${fmt(monthlyIncome)}/month)\n\n`

  out += `*How much could you borrow?*\n`
  out += `• Standard (4.5× income): *${fmt(maxBorrow4_5x)}*\n`
  out += `• Premium lenders (5.5× income): *${fmt(maxBorrow5_5x)}*\n\n`

  out += `*Max property price* (with ${depositFromMessage ? fmt(depositAssumed) : '10%'} deposit): *${fmt(maxPropertyPrice)}*\n\n`

  out += `*Monthly mortgage payments* (at ~4.5% rate):\n`
  out += `• 25-year term: *${fmt(monthlyRepayment25yr)}/month*\n`
  out += `• 35-year term: *${fmt(monthlyRepayment35yr)}/month* (lower payments, more interest)\n\n`

  out += `*Lender stress test* (at ${((currentRate + 0.03) * 100).toFixed(1)}%): ${fmt(stressTestMonthly)}/month — `
  out += debtToIncomeOk
    ? `this looks manageable on your income ✅\n\n`
    : `⚠️ this exceeds 40% of estimated net income — lenders may limit your borrowing\n\n`

  out += `*Steps to maximise borrowing:*\n`
  out += `• Clear any outstanding debts before applying — they reduce affordability\n`
  out += `• A Lifetime ISA adds 25% government top-up on savings towards a first home\n`
  out += `• Shared Ownership or Help to Buy (where available) can lower the deposit needed\n`
  out += `• Check your credit file at Experian/Equifax before applying\n\n`

  out += `_This is an estimate based on detected income and standard UK lender criteria. Actual borrowing depends on your credit score, existing debts, and individual lender assessment. Not financial advice — speak to a whole-of-market mortgage broker (free service) for personalised guidance._`

  return out
}

export function isPropertyAffordabilityRequest(message: string): boolean {
  return /how\s+much\s+(?:mortgage|can\s+i\s+borrow|house\s+can\s+i\s+afford)|(?:mortgage|property|house)\s+affordab|can\s+i\s+afford\s+(?:a\s+)?(?:house|mortgage|property)|first[\s-]?time\s+buyer|how\s+much\s+(?:can\s+i\s+borrow|mortgage\s+can\s+i)/i.test(message)
}
