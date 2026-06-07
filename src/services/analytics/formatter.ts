import type {
  AccountBalance,
  CategorySpend,
  MonthlyComparison,
  Subscription,
  UnusualTransaction,
} from './analytics.js'

// ── Deterministic templates ────────────────────────────────────────────────

function formatGBP(amount: number): string {
  return `£${amount.toFixed(2)}`
}

function formatMonthName(date: Date): string {
  return date.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
}

export function formatSpendingAnalysis(
  categories: CategorySpend[],
  comparison: MonthlyComparison,
  categoryFilter: string | undefined,
  fromDate: Date,
): string {
  if (categories.length === 0) {
    const period = categoryFilter ?? 'any category'
    return `No spending found for ${period} in the selected period.`
  }

  const total = categories.reduce((s, c) => s + c.total, 0)
  const periodLabel = formatMonthName(fromDate)

  let out = categoryFilter
    ? `Your ${categoryFilter} spending in ${periodLabel}:\n`
    : `Your spending breakdown for ${periodLabel}:\n`

  for (const c of categories.slice(0, 8)) {
    out += `• ${capitalise(c.category)}: ${formatGBP(c.total)} (${c.transactionCount} transactions)\n`
  }

  if (!categoryFilter && categories.length > 1) {
    out += `\nTotal spent: ${formatGBP(total)}`
  }

  if (comparison.lastMonth > 0) {
    const dir = comparison.changeAmount >= 0 ? 'more' : 'less'
    const pct = comparison.changePct !== null ? ` (${Math.abs(comparison.changePct).toFixed(0)}%)` : ''
    out += `\n\nThat's ${formatGBP(Math.abs(comparison.changeAmount))} ${dir} than last month${pct}.`
  }

  return out.trim()
}

export function formatSubscriptions(subscriptions: Subscription[]): string {
  if (subscriptions.length === 0) {
    return "I can't see any active subscriptions in your transaction history."
  }

  const total = subscriptions.reduce((s, sub) => s + sub.monthlyAmount, 0)

  let out = `You have ${subscriptions.length} active subscription${subscriptions.length === 1 ? '' : 's'}:\n`
  for (const sub of subscriptions.sort((a, b) => b.monthlyAmount - a.monthlyAmount)) {
    out += `• ${sub.merchantName}: ${formatGBP(sub.monthlyAmount)}/month\n`
  }
  out += `\nTotal: ${formatGBP(total)}/month`

  return out.trim()
}

export function formatUnusualSpending(transactions: UnusualTransaction[]): string {
  if (transactions.length === 0) {
    return "No unusual spending detected in the past 30 days. Everything looks normal."
  }

  let out = `I found ${transactions.length} unusual transaction${transactions.length === 1 ? '' : 's'}:\n`
  for (const t of transactions.slice(0, 6)) {
    const abs = Math.abs(t.amount)
    const date = t.transactionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const name = t.merchantName ?? 'Unknown merchant'
    out += `• ${name} — ${formatGBP(abs)} on ${date} (${t.reason})\n`
  }

  if (transactions.length > 6) {
    out += `\n…and ${transactions.length - 6} more.`
  }

  return out.trim()
}

export function formatAccountBalances(balances: AccountBalance[]): string {
  if (balances.length === 0) {
    return 'No accounts found.'
  }

  const total = balances.reduce((s, b) => s + b.currentBalance, 0)

  let out = `Your account balances:\n`
  for (const b of balances) {
    const name = b.displayName ?? capitalise(b.accountType)
    const avail =
      b.availableBalance !== null && b.availableBalance !== b.currentBalance
        ? ` (${formatGBP(b.availableBalance)} available)`
        : ''
    out += `• ${name}: ${formatGBP(b.currentBalance)}${avail}\n`
  }

  if (balances.length > 1) {
    out += `\nTotal across all accounts: ${formatGBP(total)}`
  }

  return out.trim()
}

// ── Optional LLM polish ────────────────────────────────────────────────────

export function buildFormattingPrompt(intent: string, structuredText: string, userMessage: string): string {
  return `You are Monika, a friendly UK personal finance assistant who communicates via WhatsApp.

The user asked: "${userMessage}"

Here is the accurate financial data to share with them:
${structuredText}

Rewrite this as a warm, concise WhatsApp message. Rules:
- Keep all numbers exactly as shown — do not change any figures
- Use British English
- Maximum 5 sentences or bullet points
- No emoji unless naturally appropriate
- Do not add information not present in the data above
- Do not hedge or add disclaimers

Reply with only the message text, nothing else.`
}

export async function polishWithLlm(
  intent: string,
  structuredText: string,
  userMessage: string,
  apiKey: string,
): Promise<string> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [
          { role: 'user', content: buildFormattingPrompt(intent, structuredText, userMessage) },
        ],
      }),
    })

    if (!response.ok) return structuredText

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>
    }
    const text = data.content.find((b) => b.type === 'text')?.text?.trim()
    return text ?? structuredText
  } catch {
    return structuredText
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}
