/**
 * Credit score simulation service.
 *
 * Answers "what if" questions about credit score improvement.
 * Does NOT call any credit bureau — it models the well-documented behavioural
 * factors that influence UK credit scores and estimates likely impact.
 *
 * FCA disclaimer is always included.
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface SimulationScenario {
  type:
    | 'pay_off_overdraft'
    | 'reduce_credit_utilisation'
    | 'pay_off_debt'
    | 'register_to_vote'
    | 'reduce_subscriptions'
    | 'build_savings_buffer'
    | 'generic'
  amount?: number
  label?: string
}

export function parseCreditSimulation(message: string): SimulationScenario | null {
  const lower = message.toLowerCase()
  if (!/what\s+if|if\s+i|would.*(?:improve|affect|help|change).*credit|credit.*(?:if|when)/i.test(lower)) {
    return null
  }

  const amountMatch = message.match(/£([\d,]+(?:\.\d{1,2})?)/)
  const amount = amountMatch ? parseFloat(amountMatch[1]!.replace(/,/g, '')) : undefined

  if (/overdraft/i.test(lower)) {
    const s: SimulationScenario = { type: 'pay_off_overdraft' }
    if (amount !== undefined) s.amount = amount
    return s
  }
  if (/credit\s+card|utilis/i.test(lower)) {
    const s: SimulationScenario = { type: 'reduce_credit_utilisation' }
    if (amount !== undefined) s.amount = amount
    return s
  }
  if (/debt|loan/i.test(lower)) {
    const s: SimulationScenario = { type: 'pay_off_debt', label: 'debt' }
    if (amount !== undefined) s.amount = amount
    return s
  }
  if (/register.*(vote|electoral)|electoral.*roll/i.test(lower)) return { type: 'register_to_vote' }
  if (/subscription|streaming|netflix|spotify/i.test(lower)) {
    const s: SimulationScenario = { type: 'reduce_subscriptions' }
    if (amount !== undefined) s.amount = amount
    return s
  }
  if (/sav(?:e|ings)|buffer|emergency/i.test(lower)) {
    const s: SimulationScenario = { type: 'build_savings_buffer' }
    if (amount !== undefined) s.amount = amount
    return s
  }

  return { type: 'generic' }
}

export async function simulateCreditImpact(
  prisma: PrismaClient,
  userId: string,
  scenario: SimulationScenario,
): Promise<string> {
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { currentBalance: true, accountType: true },
  })
  const currentBalance = accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0)

  let out = `🔮 *Credit score simulation*\n\n`

  switch (scenario.type) {
    case 'pay_off_overdraft': {
      const target = scenario.amount ?? Math.abs(Math.min(currentBalance, 0))
      out += `*Scenario:* Pay off ${target > 0 ? fmt(target) + ' of ' : ''}your overdraft\n\n`
      out += `*Estimated impact:*\n`
      out += `• ✅ *High positive effect* — clearing an overdraft removes a persistent red flag from lenders' view of your account conduct\n`
      out += `• Lenders can see overdraft usage via Open Banking data shared with credit reference agencies\n`
      out += `• Eliminating it typically improves your score within 1–3 months of the next account update\n\n`
      out += `*How to get there:* ${currentBalance < 0 ? `Your current balance is ${fmt(currentBalance)}. ` : ''}Even small regular top-ups reduce the overdraft faster than you might expect.\n`
      break
    }

    case 'reduce_credit_utilisation': {
      const target = scenario.amount
      out += `*Scenario:* Reduce credit card utilisation${target ? ` by ${fmt(target)}` : ''}\n\n`
      out += `*Estimated impact:*\n`
      out += `• ✅ *High positive effect* — credit utilisation (balance ÷ limit) is one of the strongest scoring factors\n`
      out += `• Getting below *30%* utilisation is the key threshold; below *10%* gives the best possible score boost\n`
      out += `• Effect is visible the month after your card issuer reports the new balance\n\n`
      out += `*Rule of thumb:* If your limit is £2,000, keeping your balance under £600 (30%) makes a meaningful difference.\n`
      break
    }

    case 'pay_off_debt': {
      const target = scenario.amount
      out += `*Scenario:* Pay off ${target ? fmt(target) + ' of ' : ''}a ${scenario.label ?? 'debt'}\n\n`
      out += `*Estimated impact:*\n`
      out += `• ✅ *Medium-to-high positive effect* — reducing outstanding debt lowers your debt-to-income ratio\n`
      out += `• Fully clearing an account (vs reducing it) has a stronger positive effect\n`
      out += `• Account closure takes 1–2 statement cycles to update at credit reference agencies\n\n`
      out += `*Next step:* Check if you have a savings account earning less than your debt's interest rate — paying off that debt first is the mathematically best move.\n`
      break
    }

    case 'register_to_vote': {
      out += `*Scenario:* Register on the electoral roll\n\n`
      out += `*Estimated impact:*\n`
      out += `• ✅ *High positive effect for low effort* — the electoral roll is one of the first identity checks lenders run\n`
      out += `• It confirms your address, which reduces fraud risk in lenders' models\n`
      out += `• Free, takes under 5 minutes, and the effect appears within 30 days\n\n`
      out += `*Do it now:* gov.uk/register-to-vote\n`
      break
    }

    case 'reduce_subscriptions': {
      const recurring = await prisma.recurringPayment.findMany({
        where: { userId, isActive: true, merchantCategory: 'entertainment' },
        select: { merchantName: true, typicalAmount: true },
      })
      const subTotal = recurring.reduce((s, r) => s + Number(r.typicalAmount), 0)
      out += `*Scenario:* Reduce subscription spending\n\n`
      if (recurring.length > 0) {
        out += `*Your current subscriptions:* ${recurring.map(r => r.merchantName).join(', ')} (${fmt(subTotal)}/month)\n\n`
      }
      out += `*Estimated impact on credit score:*\n`
      out += `• ⚠️ *Indirect effect* — subscriptions themselves don't appear on your credit file\n`
      out += `• However, reducing them frees up cash flow, which *reduces overdraft risk* and helps you build a savings buffer — both of which do improve your score\n`
      out += `• If any subscriptions are on a credit card, lower charges = lower utilisation = direct score benefit\n`
      break
    }

    case 'build_savings_buffer': {
      const target = scenario.amount ?? 1000
      out += `*Scenario:* Build a ${fmt(target)} savings buffer\n\n`
      out += `*Estimated impact:*\n`
      out += `• ✅ *Indirect but meaningful* — savings don't appear on your credit file directly\n`
      out += `• A buffer means you're less likely to dip into your overdraft in an emergency, which *does* show up on your credit file\n`
      out += `• It also signals financial resilience to lenders who use Open Banking affordability checks\n\n`
      out += `*Getting there:* ${fmt(target)} buffer = roughly ${Math.ceil(target / 200)} months at £200/month set aside.\n`
      break
    }

    default: {
      out += `I can simulate the credit score impact of several scenarios. Try asking:\n\n`
      out += `• *"What if I paid off my overdraft?"*\n`
      out += `• *"What if I reduced my credit card to 30% utilisation?"*\n`
      out += `• *"What if I registered to vote?"*\n`
      out += `• *"What if I built a £1,000 savings buffer?"*\n`
      out += `• *"What if I paid off my £2,000 loan?"*\n`
    }
  }

  out += `\n_This is an educational simulation based on publicly documented credit scoring factors. It is not financial advice and does not reflect your actual credit score. For your real score, check Experian, Equifax, or TransUnion (free via ClearScore, Credit Karma, or MSE Credit Club)._`

  return out
}

export function isCreditSimulationRequest(message: string): boolean {
  return /what\s+if.*credit|if\s+i.*(?:paid?|clear|reduced?).*(?:credit|overdraft|debt|loan)|credit.*(?:if|when|what\s+if)|would.*(?:improve|affect|boost).*(?:my\s+)?credit/i.test(message)
}
