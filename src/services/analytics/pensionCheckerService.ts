/**
 * Pension contribution checker.
 *
 * Detects pension contributions from transactions and assesses whether
 * the user is saving enough for retirement based on age-based benchmarks.
 *
 * Uses the common "half your age as a percentage" rule of thumb and
 * checks against auto-enrolment minimum (8% of qualifying earnings).
 *
 * FCA disclaimer always included.
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const PENSION_KEYWORDS = ['pension', 'nest pension', 'workplace pension', 'sipp', 'salary sacrifice', 'aviva pension', 'standard life', 'legal & general pension', 'royal london']

function detectPensionContributions(transactions: Array<{ amount: number; category: string | null; rawDescription: string | null }>): number {
  const pensionTxns = transactions.filter(t => {
    const desc = (t.rawDescription ?? '').toLowerCase()
    const cat = (t.category ?? '').toLowerCase()
    return PENSION_KEYWORDS.some(k => desc.includes(k) || cat.includes(k))
  })
  return Math.abs(pensionTxns.reduce((s, t) => s + t.amount, 0))
}

function parseAgeFromMessage(message: string): number | null {
  const match = message.match(/\b(\d{2})\s*(?:years?\s+old|yo\b|y\/o)/i)
    ?? message.match(/age\s+(?:is\s+)?(\d{2})/i)
    ?? message.match(/i(?:'?m|am)\s+(\d{2})/i)
  if (!match) return null
  const age = parseInt(match[1]!)
  return age >= 18 && age <= 70 ? age : null
}

function recommendedRate(age: number): number {
  // "Half your age" rule of thumb: age 30 → 15%, age 40 → 20%, capped at 30%
  return Math.min(age / 2, 30)
}

export async function checkPensionContributions(
  prisma: PrismaClient,
  userId: string,
  message: string,
): Promise<string> {
  const age = parseAgeFromMessage(message)
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  const [transactions, accounts] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, transactionDate: { gte: threeMonthsAgo } },
      select: { amount: true, category: true, rawDescription: true },
    }),
    prisma.account.findMany({
      where: { userId },
      select: { currentBalance: true },
    }),
  ])

  const balance = accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0)
  const monthlyPension = detectPensionContributions(
    transactions.map(t => ({
      amount: Number(t.amount),
      category: t.category,
      rawDescription: t.rawDescription,
    })),
  ) / 3

  // Estimate income from large regular credits
  const credits = transactions.filter(t => Number(t.amount) < 0)
  const monthlyIncome = Math.abs(credits.reduce((s, t) => s + Number(t.amount), 0)) / 3

  const pensionRate = monthlyIncome > 0 ? (monthlyPension / monthlyIncome) * 100 : 0

  let out = `🏦 *Pension contribution check*\n\n`

  if (monthlyPension === 0) {
    out += `I couldn't detect any pension contributions in the last 3 months.\n\n`
    out += `*What to check:*\n`
    out += `• Are you enrolled in a workplace pension? (Employers must auto-enrol from age 22)\n`
    out += `• Is your pension deducted from gross pay (salary sacrifice)? It may not appear in your transactions\n`
    out += `• Do you have a SIPP (Self-Invested Personal Pension) paid separately?\n\n`

    if (age) {
      const recommended = recommendedRate(age)
      out += `*At age ${age}*, the "half your age" rule suggests saving *${recommended}%* of income towards retirement.\n\n`
    }

    out += `*Minimum auto-enrolment:* 8% of qualifying earnings (at least 3% from employer).\n\n`
    out += `Say *"I'm 35"* and I can give you a personalised target.\n\n`
    out += `_This is educational information only and not financial advice. For personalised pension advice, consult a regulated financial adviser._`
    return out
  }

  out += `*Detected pension contribution:* ${fmt(monthlyPension)}/month\n`
  if (monthlyIncome > 0) {
    out += `*Estimated income:* ${fmt(monthlyIncome)}/month\n`
    out += `*Contribution rate:* ${pensionRate.toFixed(1)}% of income\n\n`
  }

  if (age) {
    const target = recommendedRate(age)
    out += `*At age ${age}*, the recommended rate is *${target}%* of gross income.\n\n`

    if (pensionRate >= target) {
      out += `✅ *On track!* You're contributing ${pensionRate.toFixed(1)}%, which meets or exceeds the ${target}% target for your age.\n\n`
    } else if (pensionRate >= 8) {
      const gap = target - pensionRate
      const extraMonthly = monthlyIncome * (gap / 100)
      out += `⚠️ *Room to grow:* You're contributing ${pensionRate.toFixed(1)}% — above the 8% minimum, but below the recommended ${target}%.\n\n`
      out += `*To reach ${target}%:* increase by ${gap.toFixed(1)} percentage points (≈${fmt(extraMonthly)}/month).\n\n`
    } else {
      const gapToMin = 8 - pensionRate
      out += `⚠️ *Below minimum:* You're contributing ${pensionRate.toFixed(1)}% — below the 8% auto-enrolment minimum.\n\n`
      out += `*Priority:* Check your workplace pension is active and claim your employer's full match first — it's free money.\n\n`
    }
  } else {
    const assessment = pensionRate >= 15 ? '✅ Looks healthy' : pensionRate >= 8 ? '⚠️ Above minimum but could be more' : '⚠️ Below recommended levels'
    out += `${assessment} at ${pensionRate.toFixed(1)}% of income.\n\n`
    out += `Tell me your age (e.g. *"I'm 38"*) for a personalised assessment.\n\n`
  }

  out += `💡 *Quick wins:*\n`
  out += `• Always claim your employer's full pension match — it's effectively a 100% return\n`
  out += `• Pension contributions reduce your taxable income — a ${pensionRate > 8 ? 'higher' : 'basic'}-rate taxpayer gets 20p back for every 80p contributed\n`
  out += `• A Lifetime ISA (up to age 40) adds a 25% government top-up\n\n`

  out += `_This is an educational estimate based on detected transactions. For personalised pension advice, consult a regulated financial adviser. This is not financial advice._`

  return out
}

export function isPensionRequest(message: string): boolean {
  return /pension|retirement\s+saving|how\s+much\s+.*retire|am\s+i\s+saving\s+enough.*retire|SIPP|workplace\s+pension|auto.?enrol/i.test(message)
}
