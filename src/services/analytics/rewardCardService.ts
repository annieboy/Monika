/**
 * Reward credit card optimizer.
 *
 * Analyses the user's spending distribution and recommends which credit
 * card type would yield the best cashback or rewards points, based on
 * the most popular UK reward card structures.
 *
 * Does NOT use live card data — uses representative market rates.
 * Affiliate disclosure and responsible credit use warning always included.
 */

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface CardProfile {
  name: string
  type: 'cashback' | 'points' | 'travel'
  annualFee: number
  rates: Array<{ category: string; rate: number; label: string }>
  defaultRate: number
  signUpBonus?: string
  bestFor: string
  note: string
}

// Representative UK reward card structures (not live offers — for illustration)
const CARD_PROFILES: CardProfile[] = [
  {
    name: 'Flat-rate cashback (e.g., Chase, Amex Cashback)',
    type: 'cashback',
    annualFee: 0,
    rates: [],
    defaultRate: 0.015, // 1.5% on everything
    bestFor: 'Balanced spenders with diverse categories',
    note: 'Simple: 1.5% on everything, no thinking required.',
  },
  {
    name: 'Supermarket cashback (e.g., Sainsbury\'s/Tesco credit card)',
    type: 'cashback',
    annualFee: 0,
    rates: [
      { category: 'groceries', rate: 0.05, label: '5% at supermarkets' },
      { category: 'food', rate: 0.05, label: '5% at supermarkets' },
    ],
    defaultRate: 0.005,
    bestFor: 'High grocery spend',
    note: '5% at partner supermarkets, 0.5% elsewhere.',
  },
  {
    name: 'Travel card (e.g., British Airways Amex)',
    type: 'travel',
    annualFee: 0,
    rates: [
      { category: 'travel', rate: 0.03, label: '3 Avios per £1' },
      { category: 'flights', rate: 0.03, label: '3 Avios per £1' },
    ],
    defaultRate: 0.01,
    signUpBonus: '5,000–25,000 bonus Avios on sign-up',
    bestFor: 'Frequent travellers',
    note: 'Avios worth ~1p each. Best value redeeming on flights.',
  },
  {
    name: 'Dining & entertainment (e.g., Amex Gold)',
    type: 'points',
    annualFee: 140,
    rates: [
      { category: 'eating out', rate: 0.03, label: '3 MR points per £1' },
      { category: 'restaurants', rate: 0.03, label: '3 MR points per £1' },
      { category: 'entertainment', rate: 0.02, label: '2 MR points per £1' },
      { category: 'travel', rate: 0.02, label: '2 MR points per £1' },
    ],
    defaultRate: 0.01,
    signUpBonus: '20,000 bonus points on sign-up',
    bestFor: 'High restaurant and travel spend',
    note: 'Membership Rewards points worth ~1p each. £140 fee offset by £120 dining credit.',
  },
  {
    name: 'Petrol & fuel (e.g., Barclaycard Rewards)',
    type: 'cashback',
    annualFee: 0,
    rates: [
      { category: 'fuel', rate: 0.025, label: '2.5% on fuel' },
      { category: 'transport', rate: 0.015, label: '1.5% on transport' },
    ],
    defaultRate: 0.005,
    bestFor: 'High fuel/commuting spend',
    note: '2.5% on fuel is market-leading. 0% foreign transaction fee.',
  },
]

interface SpendCategory { category: string; monthly: number }

function estimateAnnualReward(card: CardProfile, spend: SpendCategory[]): number {
  let reward = 0
  const annualSpend = spend.map(s => ({ ...s, annual: s.monthly * 12 }))

  for (const s of annualSpend) {
    const matchedRate = card.rates.find(r => s.category.toLowerCase().includes(r.category))
    const rate = matchedRate?.rate ?? card.defaultRate
    reward += s.annual * rate
  }

  return Math.round(reward - card.annualFee)
}

export function recommendRewardCard(spend: SpendCategory[]): string {
  if (spend.length === 0) {
    return (
      `To recommend a reward credit card, I need to see your spending patterns.\n\n` +
      `Connect your bank and ask me again — I'll match your spending to the card that pays you the most.`
    )
  }

  const totalMonthly = spend.reduce((s, c) => s + c.monthly, 0)

  const ranked = CARD_PROFILES
    .map(card => ({ card, annualReward: estimateAnnualReward(card, spend) }))
    .sort((a, b) => b.annualReward - a.annualReward)

  const top = ranked.slice(0, 3)
  const best = top[0]!

  let out = `💳 *Reward card optimiser*\n\n`
  out += `Based on your monthly spend of *${fmt(totalMonthly)}*, here's what each card type would earn you:\n\n`

  for (const { card, annualReward } of top) {
    const monthly = annualReward / 12
    out += `*${card.name}*\n`
    out += `Estimated reward: *${fmt(annualReward)}/year* (${fmt(monthly)}/month)\n`
    out += `Best for: ${card.bestFor}\n`
    if (card.annualFee > 0) out += `Annual fee: ${fmt(card.annualFee)} (included above)\n`
    if (card.signUpBonus) out += `Sign-up bonus: ${card.signUpBonus}\n`
    out += `${card.note}\n\n`
  }

  out += `🏆 *Best pick for you:* ${best.card.name} at *${fmt(best.annualReward)}/year*\n\n`
  out += `_Always pay your credit card balance in full each month to avoid interest charges that would wipe out the rewards. These are estimated based on representative market rates, not live offers — check comparison sites like MoneySuperMarket or MoneySavingExpert for current deals. Monika may earn a commission on applications made through partner links._`

  return out
}

export function isRewardCardRequest(message: string): boolean {
  return /(?:best|which|recommend)\s+(?:\w+\s+){0,2}card|reward\s+card\s+(?:for\s+me|recommend|suggest)|which\s+card.*(?:cashback|reward|points)|what\s+card.*most|credit\s+card\s+(?:reward|cashback|optimis)/i.test(message)
}
