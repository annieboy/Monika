/**
 * UK income tax estimator.
 *
 * Estimates income tax and National Insurance based on detected income
 * from transactions. Supports PAYE (employed) and freelance/self-employed
 * income detection.
 *
 * Uses 2024/25 tax year rates and thresholds.
 * FCA / HMRC disclaimer always included.
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// 2024/25 tax year thresholds (England, Wales, Northern Ireland)
const PERSONAL_ALLOWANCE = 12_570
const BASIC_RATE_LIMIT = 50_270   // PA + basic rate band
const HIGHER_RATE_LIMIT = 125_140 // above this = additional rate
const BASIC_RATE = 0.20
const HIGHER_RATE = 0.40
const ADDITIONAL_RATE = 0.45

// National Insurance 2024/25 (Class 1 employee / Class 4 self-employed)
const NI_PRIMARY_THRESHOLD = 12_570
const NI_UPPER_EARNINGS_LIMIT = 50_270
const NI_LOWER_RATE = 0.08  // 8% between PT and UEL (employees)
const NI_UPPER_RATE = 0.02  // 2% above UEL

function calcIncomeTax(grossAnnual: number): number {
  if (grossAnnual <= PERSONAL_ALLOWANCE) return 0
  // Personal allowance tapers above £100,000: £1 reduction per £2 above
  const effectivePa = grossAnnual > 100_000
    ? Math.max(0, PERSONAL_ALLOWANCE - Math.floor((grossAnnual - 100_000) / 2))
    : PERSONAL_ALLOWANCE

  let tax = 0
  const taxable = grossAnnual - effectivePa
  if (taxable <= 0) return 0

  const basicBand = BASIC_RATE_LIMIT - effectivePa
  const inBasic = Math.min(taxable, basicBand)
  tax += inBasic * BASIC_RATE

  if (taxable > basicBand) {
    const inHigher = Math.min(taxable - basicBand, HIGHER_RATE_LIMIT - BASIC_RATE_LIMIT)
    tax += inHigher * HIGHER_RATE
  }
  if (grossAnnual > HIGHER_RATE_LIMIT) {
    const inAdditional = grossAnnual - HIGHER_RATE_LIMIT
    tax += inAdditional * ADDITIONAL_RATE
  }
  return Math.round(tax)
}

function calcNI(grossAnnual: number): number {
  if (grossAnnual <= NI_PRIMARY_THRESHOLD) return 0
  let ni = 0
  const inLower = Math.min(grossAnnual - NI_PRIMARY_THRESHOLD, NI_UPPER_EARNINGS_LIMIT - NI_PRIMARY_THRESHOLD)
  ni += inLower * NI_LOWER_RATE
  if (grossAnnual > NI_UPPER_EARNINGS_LIMIT) {
    ni += (grossAnnual - NI_UPPER_EARNINGS_LIMIT) * NI_UPPER_RATE
  }
  return Math.round(ni)
}

function taxBand(grossAnnual: number): string {
  if (grossAnnual <= PERSONAL_ALLOWANCE) return 'no tax (below personal allowance)'
  if (grossAnnual <= BASIC_RATE_LIMIT) return '20% basic rate'
  if (grossAnnual <= HIGHER_RATE_LIMIT) return '40% higher rate'
  return '45% additional rate'
}

export async function estimateTax(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const currentYear = new Date().getFullYear()
  // UK tax year starts 6 April — use previous 12 months of income transactions
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)

  // Find credit transactions (income) — large regular credits to current accounts
  const incomeTransactions = await prisma.transaction.findMany({
    where: {
      userId,
      amount: { lt: 0 }, // credits are negative in many banking models
      transactionDate: { gte: twelveMonthsAgo },
      category: { in: ['income', 'salary', 'wages', 'freelance', 'self-employment', 'pension'] },
    },
    select: { amount: true, category: true },
    orderBy: { transactionDate: 'desc' },
    take: 200,
  })

  // If no income found by category, look for large regular credits
  const allCredits = incomeTransactions.length > 0
    ? incomeTransactions
    : await prisma.transaction.findMany({
        where: {
          userId,
          amount: { lt: 0 },
          transactionDate: { gte: twelveMonthsAgo },
        },
        select: { amount: true, category: true },
        take: 200,
      })

  const annualIncome = Math.abs(allCredits.reduce((s, t) => s + Number(t.amount ?? 0), 0))

  if (annualIncome < 100) {
    return (
      `I need income transactions to estimate your tax. Connect your bank and make sure your salary or income payments are visible in your account.\n\n` +
      `You can also tell me directly: *"My salary is £45,000"* and I'll estimate your tax.`
    )
  }

  const incomeTax = calcIncomeTax(annualIncome)
  const ni = calcNI(annualIncome)
  const total = incomeTax + ni
  const takeHome = annualIncome - total
  const effectiveRate = annualIncome > 0 ? ((total / annualIncome) * 100).toFixed(1) : '0'

  let out = `💷 *UK tax estimate (2024/25)*\n\n`
  out += `*Estimated annual income:* ${fmt(annualIncome)}\n`
  out += `*Tax band:* ${taxBand(annualIncome)}\n\n`
  out += `*Income tax:* ${fmt(incomeTax)}\n`
  out += `*National Insurance:* ${fmt(ni)}\n`
  out += `*Total deductions:* ${fmt(total)} (${effectiveRate}% effective rate)\n`
  out += `*Estimated take-home:* ${fmt(takeHome)}/yr (${fmt(takeHome / 12)}/month)\n\n`

  // Actionable tips based on band
  if (annualIncome > BASIC_RATE_LIMIT) {
    out += `💡 *Tax-saving tips for your band:*\n`
    out += `• Pension contributions reduce taxable income — £1 in pension costs you only ${annualIncome > BASIC_RATE_LIMIT ? '60p' : '80p'} as a ${annualIncome > BASIC_RATE_LIMIT ? 'higher' : 'basic'}-rate taxpayer\n`
    out += `• ISA allowance: up to £20,000/year, completely tax-free growth and withdrawals\n`
    if (annualIncome > 100_000) {
      out += `• Salary sacrifice to pension can restore your personal allowance (tapers above £100k)\n`
    }
  } else {
    out += `💡 *Tax-saving tip:* Max your ISA (£20,000/year) — all growth and withdrawals are tax-free.\n`
  }

  out += `\n_This is an estimate based on detected income. For accurate tax calculation, consult a qualified accountant or use HMRC's tax calculator at gov.uk/estimate-income-tax. Not financial or tax advice._`

  return out
}

export function isTaxEstimatorRequest(message: string): boolean {
  return /(?:how\s+much\s+)?(?:income\s+)?tax\s+(?:do\s+i|am\s+i|will\s+i)\s+(?:pay|owe)|my\s+tax\s+(?:bill|estimate|this\s+year)|estimate\s+(?:my\s+)?(?:income\s+)?tax|(?:income\s+)?tax.*(?:pay|owe|estimate)|what.*owe.*tax|tax\s+year\s+(?:estimate|summary|breakdown)|how\s+much.*NI\b/i.test(message)
}

export function parseSalaryFromMessage(message: string): number | null {
  const match = message.match(/(?:salary|earn|income|paid)\s+(?:is\s+)?£([\d,]+(?:k)?)/i)
    ?? message.match(/£([\d,]+(?:k)?)\s+(?:salary|a\s+year|per\s+year|annual)/i)
  if (!match) return null
  const raw = match[1]!.replace(/,/g, '').replace(/k$/i, '000')
  const n = parseFloat(raw)
  return isNaN(n) ? null : n
}
