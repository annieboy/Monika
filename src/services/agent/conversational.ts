/**
 * Conversational AI handler.
 *
 * When a user's question doesn't fit a structured template, this passes a
 * rich financial snapshot to Claude and lets it answer naturally. This is
 * the long-tail handler that covers the hundreds of questions users ask
 * that aren't worth individual code paths.
 *
 * Conversation history from the current session is included so Claude can
 * answer follow-up questions without losing context ("what about last month?",
 * "and Tesco specifically?", etc.).
 */
import type { FinancialSnapshot } from '../analytics/analytics.js'
import type { HistoryMessage } from '../conversation/sessionService.js'

function formatSnapshotForPrompt(snapshot: FinancialSnapshot): string {
  const balanceLines = snapshot.currentBalances
    .map(b => `  - ${b.displayName ?? b.accountType}: £${b.currentBalance.toFixed(2)}`)
    .join('\n')

  const categoryLines = snapshot.topCategories
    .map(c => `  - ${c.category}: £${c.total.toFixed(2)} (${c.transactionCount} txns)`)
    .join('\n')

  const subLines = snapshot.subscriptions
    .slice(0, 8)
    .map(s => `  - ${s.merchantName}: £${s.monthlyAmount.toFixed(2)}/month`)
    .join('\n')

  const recentLines = snapshot.recentTransactions
    .slice(0, 8)
    .map(t => `  - ${t.date}: ${t.merchant} £${t.amount.toFixed(2)}${t.category ? ` (${t.category})` : ''}`)
    .join('\n')

  return `FINANCIAL DATA (today: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })})

Account balances:
${balanceLines || '  (no accounts)'}
Total balance: £${snapshot.totalBalance.toFixed(2)}

This month's spending: £${snapshot.thisMonthSpend.toFixed(2)}
Last month's spending: £${snapshot.lastMonthSpend.toFixed(2)}
${snapshot.monthlyIncome > 0 ? `Monthly income (avg): £${snapshot.monthlyIncome.toFixed(2)}` : 'Income: not detected in transactions'}
${snapshot.savingsRate !== null ? `Savings rate: ~${snapshot.savingsRate.toFixed(0)}%` : ''}

Top spending categories this month:
${categoryLines || '  (no spending yet this month)'}

Subscriptions (£${snapshot.totalSubscriptions.toFixed(2)}/month total):
${subLines || '  (none detected)'}

Recent transactions (last 7 days):
${recentLines || '  (none)'}`
}

export async function answerWithAI(
  userMessage: string,
  snapshot: FinancialSnapshot,
  apiKey: string,
  history: HistoryMessage[] = [],
): Promise<string | null> {
  const systemPrompt = `You are Monika, a friendly and knowledgeable UK personal finance assistant. You communicate via WhatsApp — keep responses concise, warm, and practical.

Rules:
- Use British English and £ for currency
- Be direct and specific — give real numbers from the data
- Never make up figures not in the data
- If you can't answer from the data provided, say so honestly and suggest what the user could do
- Maximum 8 lines or bullet points
- Do not suggest connecting a bank (it's already connected)
- Do not execute payments or transfers — you are read-only
- Format numbers as £X,XXX.XX
- Today's date is provided in the data`

  // The financial snapshot is prepended to the first user turn so it's always
  // in context. If there's prior history, earlier turns come first.
  const snapshotContext = `Here is the user's financial data:\n\n${formatSnapshotForPrompt(snapshot)}\n\n`

  // Build message list: history + current message
  // The snapshot is injected once at the top of the first user message.
  const messages: { role: 'user' | 'assistant'; content: string }[] = []

  if (history.length === 0) {
    messages.push({ role: 'user', content: `${snapshotContext}The user asked: "${userMessage}"` })
  } else {
    // Prepend snapshot to the oldest user message so Claude always has data context
    const [first, ...rest] = history
    if (first) {
      messages.push({
        role: first.role,
        content: first.role === 'user'
          ? `${snapshotContext}${first.content}`
          : first.content,
      })
    }
    messages.push(...rest)
    messages.push({ role: 'user', content: userMessage })
  }

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
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>
    }
    return data.content.find(b => b.type === 'text')?.text?.trim() ?? null
  } catch {
    return null
  }
}
