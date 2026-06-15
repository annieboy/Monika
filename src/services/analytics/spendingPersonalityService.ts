/**
 * Spending personality service.
 *
 * Analyses the user's spending distribution across categories to identify
 * a dominant spending archetype. Provides personalised, actionable insights.
 *
 * Archetypes: Foodie, Homebody, Adventurer, Tech Enthusiast, Social Butterfly,
 * Saver, Commuter, Health Enthusiast, Balanced
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface SpendingArchetype {
  name: string
  emoji: string
  description: string
  tip: string
  savingHack: string
}

const ARCHETYPES: Record<string, SpendingArchetype> = {
  foodie: {
    name: 'The Foodie',
    emoji: '🍽️',
    description: 'A significant portion of your spending goes on food and dining — restaurants, cafés, and takeaways are your happy place.',
    tip: 'Try the "one cook-in per dining-out" rule: for every restaurant meal, cook one meal at home. You could halve your food costs without feeling deprived.',
    savingHack: 'Meal-kit services like HelloFresh or Gousto are often cheaper than restaurants and scratch the "trying new food" itch.',
  },
  homebody: {
    name: 'The Homebody',
    emoji: '🏠',
    description: 'Home and utilities take up a healthy share of your budget. You invest in your living space.',
    tip: 'Check if your utility tariffs are competitive — most people save £200–£400/year by switching energy provider.',
    savingHack: 'Smart plugs and a smart thermostat can cut energy bills by 10–15% with minimal lifestyle change.',
  },
  adventurer: {
    name: 'The Adventurer',
    emoji: '✈️',
    description: 'Travel and experiences are where your money goes — flights, hotels, and activities. Life is for living!',
    tip: 'Set a dedicated travel pot (most banks support pots/spaces). When it\'s empty, the trip waits — no debt, no guilt.',
    savingHack: 'A travel credit card with 0% foreign fees (like Chase or Starling) saves roughly 3% on every overseas purchase.',
  },
  tech: {
    name: 'The Tech Enthusiast',
    emoji: '💻',
    description: 'Gadgets, subscriptions, and tech services are your weakness — always on the bleeding edge.',
    tip: 'Audit your subscriptions every 6 months. Tech subscriptions tend to accumulate silently — you probably have 2–3 you\'ve forgotten about.',
    savingHack: 'Refurbished devices (Apple Certified, Amazon Renewed) are typically 20–30% cheaper with the same warranty.',
  },
  social: {
    name: 'The Social Butterfly',
    emoji: '🥂',
    description: 'Entertainment and social outings are a big part of your life — bars, events, and activities with friends.',
    tip: 'Try a "fun fund" — set a fixed monthly amount for socialising. When it\'s gone, suggest free alternatives: parks, cooking together, free events.',
    savingHack: 'Pre-drinking at home, splitting Ubers, and using Wetherspoon as a starting point can cut a night out cost by 40%.',
  },
  saver: {
    name: 'The Super Saver',
    emoji: '💰',
    description: 'Your spending is remarkably lean — you live well below your means. Disciplined and intentional.',
    tip: 'Make sure your savings are working hard. If they\'re in a current account, you\'re losing to inflation — move them to a high-rate ISA.',
    savingHack: 'At your saving rate, consider S&S ISA investing. Even modest equity returns compound significantly over 5+ years.',
  },
  commuter: {
    name: 'The Commuter',
    emoji: '🚂',
    description: 'Transport costs are a meaningful part of your outgoings — trains, fuel, or ride-sharing.',
    tip: 'Annual rail passes save up to 50% vs daily tickets. A 16-25/26-30 Railcard (if eligible) saves a third off most fares.',
    savingHack: 'Work-from-home even one day/week can cut annual commute costs by 20%.',
  },
  health: {
    name: 'The Health Enthusiast',
    emoji: '🏃',
    description: 'Health, fitness, and wellbeing are priorities — gym, classes, supplements, and healthy food.',
    tip: 'Check if you\'re using all your gym visits. Many people pay for 3–4 gyms simultaneously. Consolidate and redirect the saving.',
    savingHack: 'Many NHS trusts offer subsidised gym membership. Council leisure centres are often 50% cheaper than premium gyms.',
  },
  balanced: {
    name: 'The Balanced Spender',
    emoji: '⚖️',
    description: 'Your spending is well-distributed across categories — you don\'t have one dominant habit. Healthy variety.',
    tip: 'With balanced spending, the biggest lever is usually reducing the top-3 categories by 10%. Small cuts everywhere add up.',
    savingHack: 'A zero-based budget (every £ has a job) suits balanced spenders — apps like Emma or Snoop can automate the tracking.',
  },
}

const CATEGORY_ARCHETYPE_MAP: Record<string, string> = {
  'eating out': 'foodie', 'restaurants': 'foodie', 'takeaway': 'foodie', 'coffee': 'foodie',
  'groceries': 'foodie', 'food': 'foodie',
  'rent': 'homebody', 'housing': 'homebody', 'utilities': 'homebody', 'home': 'homebody',
  'travel': 'adventurer', 'flights': 'adventurer', 'hotels': 'adventurer', 'holiday': 'adventurer',
  'electronics': 'tech', 'subscriptions': 'tech', 'software': 'tech', 'tech': 'tech',
  'entertainment': 'social', 'bars': 'social', 'pubs': 'social', 'nightlife': 'social',
  'savings': 'saver', 'investments': 'saver',
  'transport': 'commuter', 'commute': 'commuter', 'fuel': 'commuter', 'rail': 'commuter', 'trains': 'commuter',
  'gym': 'health', 'fitness': 'health', 'healthcare': 'health', 'sport': 'health',
}

function detectArchetype(categoryTotals: Array<{ category: string | null; total: number }>): string {
  const archetypeScores: Record<string, number> = {}
  const grandTotal = categoryTotals.reduce((s, c) => s + c.total, 0)

  for (const { category, total } of categoryTotals) {
    const lower = (category ?? '').toLowerCase()
    const archetype = Object.entries(CATEGORY_ARCHETYPE_MAP).find(([k]) => lower.includes(k))?.[1]
    if (archetype) {
      archetypeScores[archetype] = (archetypeScores[archetype] ?? 0) + total
    }
  }

  const top = Object.entries(archetypeScores).sort((a, b) => b[1] - a[1])[0]
  if (!top || (grandTotal > 0 && top[1] / grandTotal < 0.2)) return 'balanced'
  return top[0]
}

export async function getSpendingPersonality(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  const spending = await prisma.transaction.groupBy({
    by: ['category'],
    where: {
      userId,
      amount: { gt: 0 },
      transactionDate: { gte: threeMonthsAgo },
    },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
  })

  if (spending.length === 0) {
    return (
      `I need a few months of transaction data to identify your spending personality.\n\n` +
      `Connect your bank and ask me again after a month or two!`
    )
  }

  const categoryTotals = spending.map(s => ({
    category: s.category,
    total: Number((s._sum as { amount?: unknown }).amount ?? 0),
  }))

  const totalSpend = categoryTotals.reduce((s, c) => s + c.total, 0)
  const archetypeKey = detectArchetype(categoryTotals)
  const archetype = ARCHETYPES[archetypeKey] ?? ARCHETYPES['balanced']!

  // Top 3 categories
  const top3 = categoryTotals.slice(0, 3)

  let out = `${archetype.emoji} *Your spending personality: ${archetype.name}*\n\n`
  out += `${archetype.description}\n\n`

  out += `*Your top spending categories (last 3 months):*\n`
  for (const { category, total } of top3) {
    const pct = totalSpend > 0 ? Math.round((total / totalSpend) * 100) : 0
    out += `• ${category ?? 'Other'}: ${fmt(total)} (${pct}%)\n`
  }

  out += `\n💡 *Tip for your personality:* ${archetype.tip}\n\n`
  out += `🔧 *Saving hack:* ${archetype.savingHack}`

  return out
}

export function isSpendingPersonalityRequest(message: string): boolean {
  return /spending\s+personality|spending\s+(?:style|type|profile|habits?)|what\s+(?:kind|type)\s+of\s+spender|how\s+do\s+i\s+spend|my\s+spending\s+(?:habits?|style|profile)/i.test(message)
}
