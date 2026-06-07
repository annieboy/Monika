/** Extracts query parameters (date range, category) from free-text messages. */

export interface QueryContext {
  fromDate: Date
  toDate: Date
  categoryFilter: string | undefined
}

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/groceries|supermarket|food\s+shopping|tesco|sainsbury|waitrose|lidl|aldi/i, 'groceries'],
  [/eating\s+out|restaurants?|dining|takeaway|takeout|deliveroo|uber\s+eats|costa|greggs|pret/i, 'restaurants'],
  [/transport|travel|commut|tube|train|bus|uber|taxi|tfl|trainline/i, 'transport'],
  [/subscriptions?|netflix|spotify|amazon\s+prime|disney|streaming|gym/i, 'subscriptions'],
  [/shopping|clothes|clothing|amazon|asos/i, 'shopping'],
  [/bills|utilities|vodafone|broadband/i, 'bills'],
  [/health|pharmacy|boots|chemist/i, 'health'],
]

export function extractQueryContext(message: string): QueryContext {
  const now = new Date()

  // Date range
  let fromDate: Date
  let toDate: Date

  if (/last\s+month/i.test(message)) {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    fromDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1)
    toDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0, 23, 59, 59, 999)
  } else if (/last\s+(\d+)\s+days?/i.test(message)) {
    const match = message.match(/last\s+(\d+)\s+days?/i)
    const days = parseInt(match?.[1] ?? '30', 10)
    fromDate = new Date(now.getTime() - days * 86_400_000)
    toDate = now
  } else if (/last\s+week/i.test(message)) {
    fromDate = new Date(now.getTime() - 7 * 86_400_000)
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

  return { fromDate, toDate, categoryFilter }
}
