/** Extracts query parameters (date range, category) from free-text messages. */

export interface QueryContext {
  fromDate: Date
  toDate: Date
  categoryFilter: string | undefined
  merchantFilter: string | undefined
}

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/groceries|supermarket|food\s+shopping|tesco|sainsbury|waitrose|lidl|aldi|morrisons|asda/i, 'groceries'],
  [/eating\s+out|restaurants?|dining|takeaway|takeout|deliveroo|uber\s+eats|just\s+eat|costa|greggs|pret|mcdonalds|kfc|nando/i, 'restaurants'],
  [/transport|travel|commut|tube|train|bus|uber|taxi|tfl|trainline|national\s+rail|oyster|petrol|fuel|parking/i, 'transport'],
  [/subscriptions?|netflix|spotify|amazon\s+prime|disney|apple\s+tv|streaming|gym|membership/i, 'subscriptions'],
  [/shopping|clothes|clothing|amazon|asos|next|zara|h&m|primark|john\s+lewis/i, 'shopping'],
  [/bills|utilities|electric|gas|water|council\s+tax|broadband|vodafone|o2|ee|bt\b/i, 'bills'],
  [/health|pharmacy|boots|chemist|dentist|doctor|gp|nhs|gym/i, 'health'],
  [/entertainment|cinema|theatre|spotify|concerts?|events?/i, 'entertainment'],
  [/holidays?|flights?|hotels?|airbnb|booking\.com|travel/i, 'travel'],
  [/rent|mortgage|landlord/i, 'rent'],
  [/alcohol|pub|bar|drinks?|wine|beer/i, 'drinking'],
  [/coffee|cafe|starbucks|costa|caffe\s+nero/i, 'coffee'],
  [/savings?|isa|investment/i, 'savings'],
  [/insurance/i, 'insurance'],
  [/charity|donation/i, 'charity'],
]

// Named merchant extraction for "how much at X" queries
const MERCHANT_PATTERNS: Array<[RegExp, string]> = [
  [/\bat\s+tesco\b/i, 'tesco'],
  [/\bat\s+sainsbury/i, 'sainsbury'],
  [/\bat\s+amazon\b/i, 'amazon'],
  [/\bat\s+waitrose\b/i, 'waitrose'],
  [/\bat\s+asda\b/i, 'asda'],
  [/\bat\s+lidl\b/i, 'lidl'],
  [/\bat\s+aldi\b/i, 'aldi'],
  [/\bat\s+morrisons\b/i, 'morrisons'],
  [/\bat\s+boots\b/i, 'boots'],
  [/\bat\s+next\b/i, 'next'],
  [/\bat\s+primark\b/i, 'primark'],
  [/\bon\s+amazon\b/i, 'amazon'],
  [/\bon\s+deliveroo\b/i, 'deliveroo'],
  [/\bon\s+uber\s+eats\b/i, 'uber eats'],
  [/\bdeliveroo\b/i, 'deliveroo'],
  [/\buber\s+eats\b/i, 'uber eats'],
  [/\bjust\s+eat\b/i, 'just eat'],
]

const KNOWN_CATEGORY_WORDS =
  /^(bills?|utilities|groceries|grocery|food|supermarket|transport|travel|shopping|clothes|clothing|subscriptions?|streaming|entertainment|health|pharmacy|rent|mortgage|coffee|savings?|insurance|charity|donations?|dining|eating\s*out|restaurants?|takeaway|takeaways|fast\s*food|petrol|fuel|drinks?|drinking|alcohol)$/i

/**
 * For "how much did I spend ON <X>" questions: pulls out <X> and says whether
 * it's a known spending category or should be treated as a merchant/payee.
 * This is what lets "spend on groceries" do a category breakdown while "spend
 * on Winners Chapel" searches for the merchant.
 */
export function extractSpendSubject(message: string): { subject: string; isCategory: boolean } | null {
  const m = message.match(
    /\b(?:spend|spent|spending)\s+(?:on|at|to|with)\s+([a-z0-9&'. ]+?)(?:\s+(?:this|last|in|over|since|before|during|for|per)\b|[?.!]|$)/i,
  )
  const subject = m?.[1]?.trim()
  if (!subject) return null
  const isCategory =
    KNOWN_CATEGORY_WORDS.test(subject) ||
    CATEGORY_PATTERNS.some(([pattern]) => pattern.test(subject))
  return { subject, isCategory }
}

/**
 * For "how much do I earn/receive from <X>" questions: pulls out the payer so
 * we can sum the money COMING IN from them (credits), rather than guessing at a
 * salary flag. Returns null when it isn't an income-from-payer question.
 */
export function extractEarnSubject(message: string): string | null {
  const m = message.match(
    /\b(?:earn|earned|earning|income|paid|receive|received|get|getting)\s+(?:from|by|via|through)\s+([a-z0-9&'. ]+?)(?:\s+(?:this|last|in|over|since|before|during|for|per|each)\b|[?.!]|$)/i,
  )
  const subject = m?.[1]?.trim()
  return subject && subject.length > 1 ? subject : null
}

export function extractQueryContext(message: string): QueryContext {
  const now = new Date()

  // Date range
  let fromDate: Date
  let toDate: Date

  if (/last\s+year|past\s+year|\d{4}/i.test(message) && !/last\s+month|last\s+week/i.test(message)) {
    const year = message.match(/(\d{4})/)?.[1]
    if (year) {
      fromDate = new Date(parseInt(year), 0, 1)
      toDate = new Date(parseInt(year), 11, 31, 23, 59, 59, 999)
    } else {
      fromDate = new Date(now.getFullYear() - 1, 0, 1)
      toDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999)
    }
  } else if (/last\s+month/i.test(message)) {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    fromDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1)
    toDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0, 23, 59, 59, 999)
  } else if (/last\s+(\d+)\s+months?/i.test(message)) {
    const match = message.match(/last\s+(\d+)\s+months?/i)
    const months = parseInt(match?.[1] ?? '3', 10)
    fromDate = new Date(now.getFullYear(), now.getMonth() - months, 1)
    toDate = now
  } else if (/last\s+(\d+)\s+days?/i.test(message)) {
    const match = message.match(/last\s+(\d+)\s+days?/i)
    const days = parseInt(match?.[1] ?? '30', 10)
    fromDate = new Date(now.getTime() - days * 86_400_000)
    toDate = now
  } else if (/last\s+week|past\s+week/i.test(message)) {
    fromDate = new Date(now.getTime() - 7 * 86_400_000)
    toDate = now
  } else if (/this\s+year|year\s+to\s+date|ytd/i.test(message)) {
    fromDate = new Date(now.getFullYear(), 0, 1)
    toDate = now
  } else if (/tax\s+year/i.test(message)) {
    // UK tax year: April 6 to April 5
    const taxYearStart = now.getMonth() >= 3 && (now.getMonth() > 3 || now.getDate() >= 6)
      ? new Date(now.getFullYear(), 3, 6)
      : new Date(now.getFullYear() - 1, 3, 6)
    fromDate = taxYearStart
    toDate = now
  } else if (/yesterday/i.test(message)) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    fromDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())
    toDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59)
  } else if (/\btoday\b|so\s+far\s+today|\bthis\s+morning\b/i.test(message)) {
    fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    toDate = now
  } else if (/this\s+week|past\s+7\s+days/i.test(message)) {
    // Start of the current week (Monday)
    const day = now.getDay() // 0 = Sun
    const daysSinceMonday = (day + 6) % 7
    fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday)
    toDate = now
  } else {
    // Default: current month
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1)
    toDate = now
  }

  // Category
  let categoryFilter: string | undefined
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(message)) {
      categoryFilter = category
      break
    }
  }

  // Merchant
  let merchantFilter: string | undefined
  for (const [pattern, merchant] of MERCHANT_PATTERNS) {
    if (pattern.test(message)) {
      merchantFilter = merchant
      break
    }
  }

  return { fromDate, toDate, categoryFilter, merchantFilter }
}
