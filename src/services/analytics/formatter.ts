import type {
  AccountBalance,
  AffordabilityProfile,
  CategorySpend,
  MonthlyComparison,
  SafeToSpend,
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

export function formatMerchantSpend(
  merchantName: string,
  data: { total: number; transactionCount: number; transactions: Array<{ date: string; merchant: string; amount: number }> },
  fromDate: Date,
): string {
  if (data.transactionCount === 0) {
    return `No transactions found at ${merchantName} in the selected period.`
  }
  const period = formatMonthName(fromDate)
  let out = `Your ${merchantName} spending in ${period}:\n`
  out += `• Total: ${formatGBP(data.total)} across ${data.transactionCount} transaction${data.transactionCount === 1 ? '' : 's'}\n`
  if (data.transactions.length <= 5) {
    for (const t of data.transactions) {
      out += `• ${t.date}: ${formatGBP(t.amount)}\n`
    }
  }
  return out.trim()
}

export function formatIncomeQuery(monthlyIncome: number, lastSalaryDate: Date | null, nextEstimatedDate: Date | null): string {
  if (monthlyIncome === 0) {
    return `I couldn't detect a regular salary in your connected account. Your income may be paid into a different account, or it might not be labelled as a salary in the transaction data.`
  }

  let out = `Based on your transaction history:\n`
  out += `• Average monthly income: ${formatGBP(monthlyIncome)}\n`
  if (lastSalaryDate) {
    out += `• Last salary: ${lastSalaryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
  }
  if (nextEstimatedDate) {
    out += `\n• Next expected: ~${nextEstimatedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
  }
  return out.trim()
}

export function formatSavingsQuery(monthlyIncome: number, thisMonthSpend: number, savingsRate: number | null): string {
  if (monthlyIncome === 0) {
    return `I can see your spending but couldn't detect your income in the connected account. To calculate your savings rate, your salary needs to come into this account.`
  }

  const monthlySaving = Math.max(0, monthlyIncome - thisMonthSpend)
  let out = `Your savings picture this month:\n`
  out += `• Income: ${formatGBP(monthlyIncome)}\n`
  out += `• Spending: ${formatGBP(thisMonthSpend)}\n`
  out += `• Saving: ${formatGBP(monthlySaving)}`
  if (savingsRate !== null) {
    out += `\n• Savings rate: ${savingsRate.toFixed(0)}%`
    if (savingsRate < 10) out += ` — aim for 20%`
    else if (savingsRate >= 20) out += ` — great going ✓`
  }
  return out.trim()
}

export function formatUpcomingBills(subscriptions: Subscription[], _committedThisMonth: number): string {
  if (subscriptions.length === 0) {
    return `I don't see any upcoming direct debits or subscriptions in your transaction history.`
  }

  const total = subscriptions.reduce((s, sub) => s + sub.monthlyAmount, 0)
  let out = `Upcoming committed payments this month:\n`
  for (const sub of subscriptions.sort((a, b) => b.monthlyAmount - a.monthlyAmount).slice(0, 8)) {
    out += `• ${sub.merchantName}: ${formatGBP(sub.monthlyAmount)}\n`
  }
  out += `\nTotal: ${formatGBP(total)}/month`
  return out.trim()
}

export function formatAffordability(profile: AffordabilityProfile, userMessage: string): string {
  const { monthlyIncome, totalMonthlyCommitted, disposableIncome, currentBalance, savingsRate } = profile

  // Extract a target amount from the message (e.g. "£400k mortgage", "£1,200 sofa")
  const amountMatch = userMessage.match(/£([\d,]+)k?\b/i)
  let targetAmount: number | null = null
  if (amountMatch?.[1]) {
    const raw = parseFloat(amountMatch[1].replace(/,/g, ''))
    targetAmount = userMessage.toLowerCase().includes('k') ? raw * 1000 : raw
  }

  const isMortgage = /mortgage/i.test(userMessage)

  let out = ''

  if (monthlyIncome === 0) {
    out = `I can see your spending but couldn't detect a regular salary in your transactions. `
    out += `To answer this properly, your income needs to be visible in your connected account.\n\n`
    out += `What I can see:\n`
    out += `• Current balance: ${formatGBP(currentBalance)}\n`
    out += `• Monthly committed costs: ${formatGBP(totalMonthlyCommitted)}`
    return out.trim()
  }

  if (isMortgage && targetAmount) {
    // Rough mortgage affordability: lenders typically offer 4-4.5x salary
    const annualIncome = monthlyIncome * 12
    const maxBorrow4x = annualIncome * 4
    const maxBorrow45x = annualIncome * 4.5
    const canAfford = targetAmount <= maxBorrow45x

    // Estimated monthly repayment (25yr, ~5% rate)
    const monthlyRepayment = (targetAmount * 0.005 * Math.pow(1.005, 300)) / (Math.pow(1.005, 300) - 1)
    const affordableRepayment = disposableIncome * 0.45 // lenders want < 45% of disposable

    out += canAfford
      ? `Based on your income, a £${(targetAmount / 1000).toFixed(0)}k mortgage could be within reach.\n\n`
      : `A £${(targetAmount / 1000).toFixed(0)}k mortgage may be a stretch based on your income.\n\n`

    out += `Here's the breakdown:\n`
    out += `• Monthly income: ${formatGBP(monthlyIncome)}\n`
    out += `• Typical lender max (4–4.5× salary): ${formatGBP(maxBorrow4x)}–${formatGBP(maxBorrow45x)}\n`
    out += `• Est. monthly repayment: ${formatGBP(monthlyRepayment)} (25yr, ~5%)\n`
    out += `• Your current disposable income: ${formatGBP(disposableIncome)}\n`
    out += monthlyRepayment <= affordableRepayment
      ? `• Repayment looks manageable vs your income ✓`
      : `• Repayment would be tight vs your current outgoings ⚠️`
  } else if (targetAmount) {
    const canAfford = targetAmount <= disposableIncome
    out += canAfford
      ? `Yes, ${formatGBP(targetAmount)} looks affordable.\n\n`
      : `${formatGBP(targetAmount)} would stretch your finances this month.\n\n`
    out += `• Monthly disposable income: ${formatGBP(disposableIncome)}\n`
    out += `• Current balance: ${formatGBP(currentBalance)}`
  } else {
    out += `Your financial snapshot:\n`
    out += `• Monthly income: ${formatGBP(monthlyIncome)}\n`
    out += `• Committed costs: ${formatGBP(totalMonthlyCommitted)} (essentials + subscriptions)\n`
    out += `• Disposable income: ${formatGBP(disposableIncome)}\n`
    out += `• Current balance: ${formatGBP(currentBalance)}`
    if (savingsRate !== null) out += `\n• Savings rate: ~${savingsRate.toFixed(0)}%`
  }

  return out.trim()
}

export function formatSafeToSpend(data: SafeToSpend): string {
  const { currentBalance, committedThisPeriod, safeAmount, periodLabel, warningFlags } = data

  let out = `Safe to spend ${periodLabel}: ${formatGBP(safeAmount)}\n\n`
  out += `• Current balance: ${formatGBP(currentBalance)}\n`
  if (committedThisPeriod > 0) {
    out += `• Bills due soon: ${formatGBP(committedThisPeriod)}\n`
  }
  out += `• Buffer kept: £50`

  if (warningFlags.length > 0) {
    out += `\n\n⚠️ ${warningFlags.join(' · ')}`
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
