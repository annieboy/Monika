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

// ── Explicit / absolute date parsing ───────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
}

function monthIndex(word: string | undefined): number | null {
  if (!word) return null
  const idx = MONTHS[word.toLowerCase()]
  return idx === undefined ? null : idx
}

/** Most recent year in which `monthIdx` has already started, relative to `now`. */
function mostRecentMonthYear(monthIdx: number, now: Date): number {
  return monthIdx > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear()
}

function dayRange(y: number, m: number, d: number): { fromDate: Date; toDate: Date } {
  return { fromDate: new Date(y, m, d, 0, 0, 0, 0), toDate: new Date(y, m, d, 23, 59, 59, 999) }
}

function monthRange(y: number, m: number): { fromDate: Date; toDate: Date } {
  return { fromDate: new Date(y, m, 1, 0, 0, 0, 0), toDate: new Date(y, m + 1, 0, 23, 59, 59, 999) }
}

/**
 * Pulls an explicit/absolute date or date range out of a message:
 *   "on the 3rd", "on 5 November", "5 Nov 2025", "12/11", "2026-11-03",
 *   "in October", "last October", "between June and August".
 * Returns null when the message has no absolute date reference (so the caller
 * falls back to the usual relative-period handling). Clamps the end to now.
 */
export function extractExplicitDateRange(
  message: string,
  now: Date = new Date(),
): { fromDate: Date; toDate: Date } | null {
  const clamp = (r: { fromDate: Date; toDate: Date }): { fromDate: Date; toDate: Date } =>
    r.toDate > now ? { fromDate: r.fromDate, toDate: now } : r

  // 1) ISO date: 2026-11-03
  const iso = message.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) {
    const y = +iso[1]!, m = +iso[2]! - 1, d = +iso[3]!
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) return clamp(dayRange(y, m, d))
  }

  // 2) Month range: "between June and August", "from Jun to Aug"
  const range = message.match(/\b(?:between|from)\s+([a-z]+)\s+(?:and|to|through|til|till|until|-)\s+([a-z]+)/i)
  if (range) {
    const aIdx = monthIndex(range[1]), bIdx = monthIndex(range[2])
    if (aIdx !== null && bIdx !== null) {
      const bYear = mostRecentMonthYear(bIdx, now)
      const aYear = aIdx <= bIdx ? bYear : bYear - 1
      return clamp({ fromDate: monthRange(aYear, aIdx).fromDate, toDate: monthRange(bYear, bIdx).toDate })
    }
  }

  // 3) Day + month: "5 November", "5th of Nov 2025", "November 5", "Nov 5th, 2025"
  const dayMonth = message.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\b(?:\s+(\d{4}))?/i)
  if (dayMonth) {
    const d = +dayMonth[1]!, mIdx = monthIndex(dayMonth[2])
    if (mIdx !== null && d >= 1 && d <= 31) {
      const y = dayMonth[3] ? +dayMonth[3] : mostRecentMonthYear(mIdx, now)
      return clamp(dayRange(y, mIdx, d))
    }
  }
  const monthDay = message.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i)
  if (monthDay) {
    const mIdx = monthIndex(monthDay[1]), d = +monthDay[2]!
    if (mIdx !== null && d >= 1 && d <= 31) {
      const y = monthDay[3] ? +monthDay[3] : mostRecentMonthYear(mIdx, now)
      return clamp(dayRange(y, mIdx, d))
    }
  }

  // 4) UK numeric date: 12/11 or 12/11/2026 (day/month[/year])
  const slash = message.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (slash) {
    const d = +slash[1]!, m = +slash[2]! - 1
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      let y = slash[3] ? +slash[3] : mostRecentMonthYear(m, now)
      if (y < 100) y += 2000
      return clamp(dayRange(y, m, d))
    }
  }

  // 5) Whole named month: "in October", "during Nov", "last October", "this June".
  // "this may" is skipped — far more often the modal verb ("this may be…") than
  // the month of May.
  const inMonth = message.match(/\b(in|during|last|this)\s+([a-z]+)\b/i)
  if (inMonth) {
    const trigger = inMonth[1]!.toLowerCase()
    const mIdx = monthIndex(inMonth[2])
    if (mIdx !== null && !(trigger === 'this' && mIdx === 4)) {
      const y = mostRecentMonthYear(mIdx, now)
      return clamp(monthRange(y, mIdx))
    }
  }

  // 6) Bare day-of-month: "on the 3rd", "the 21st" (ordinal required, no trailing noun)
  const dom = message.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+[a-z])/i)
  if (dom) {
    const d = +dom[1]!
    if (d >= 1 && d <= 31) {
      let candidate = new Date(now.getFullYear(), now.getMonth(), d)
      if (candidate > now) candidate = new Date(now.getFullYear(), now.getMonth() - 1, d)
      return clamp(dayRange(candidate.getFullYear(), candidate.getMonth(), d))
    }
  }

  return null
}

export function extractQueryContext(message: string): QueryContext {
  const now = new Date()

  // Date range
  let fromDate: Date
  let toDate: Date

  // Absolute dates ("on the 3rd", "in October", "between June and August",
  // "5 Nov", "2026-11-03") take priority over relative-period parsing.
  const explicit = extractExplicitDateRange(message, now)
  if (explicit) {
    fromDate = explicit.fromDate
    toDate = explicit.toDate
  } else if (/last\s+year|past\s+year|\d{4}/i.test(message) && !/last\s+month|last\s+week/i.test(message)) {
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
