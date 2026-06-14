import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyIntent } from '../classifier.js'

// No API key → pure rules path in all tests
const NO_KEY = ''

describe('classifyIntent — acceptance criteria', () => {
  it('spending_analysis: "How much did I spend on groceries this month?"', async () => {
    const result = await classifyIntent('How much did I spend on groceries this month?', NO_KEY)
    expect(result.intent).toBe('spending_analysis')
    expect(result.method).toBe('rules')
    expect(result.confidence).toBe('high')
  })

  it('subscription_detection: "What subscriptions am I paying for?"', async () => {
    const result = await classifyIntent('What subscriptions am I paying for?', NO_KEY)
    expect(result.intent).toBe('subscription_detection')
  })

  it('affordability_question: "Can I afford rent next month?"', async () => {
    const result = await classifyIntent('Can I afford rent next month?', NO_KEY)
    expect(result.intent).toBe('affordability_question')
  })

  it('unusual_spending: "Show me weird spending"', async () => {
    const result = await classifyIntent('Show me weird spending', NO_KEY)
    expect(result.intent).toBe('unusual_spending')
  })

  it('account_balance: "What\'s my balance?"', async () => {
    const result = await classifyIntent("What's my balance?", NO_KEY)
    expect(result.intent).toBe('account_balance')
  })
})

describe('classifyIntent — additional spending_analysis patterns', () => {
  it('"How much have I spent on eating out?"', async () => {
    const result = await classifyIntent('How much have I spent on eating out?', NO_KEY)
    expect(result.intent).toBe('spending_analysis')
  })

  it('"Show me my expenses this month"', async () => {
    const result = await classifyIntent('Show me my expenses this month', NO_KEY)
    expect(result.intent).toBe('spending_analysis')
  })

  it('"What are my outgoings?"', async () => {
    const result = await classifyIntent('What are my outgoings?', NO_KEY)
    expect(result.intent).toBe('spending_analysis')
  })
})

describe('classifyIntent — subscription_detection patterns', () => {
  it('detects direct debit question', async () => {
    const result = await classifyIntent('What direct debits do I have?', NO_KEY)
    expect(result.intent).toBe('subscription_detection')
  })

  it('detects named service (Netflix)', async () => {
    const result = await classifyIntent('Am I still paying for Netflix?', NO_KEY)
    expect(result.intent).toBe('subscription_detection')
  })

  it('detects recurring payment question', async () => {
    const result = await classifyIntent('Show me my recurring payments', NO_KEY)
    expect(result.intent).toBe('subscription_detection')
  })
})

describe('classifyIntent — affordability_question patterns', () => {
  it('"Will I have enough money for a holiday?"', async () => {
    const result = await classifyIntent('Will I have enough money for a holiday?', NO_KEY)
    expect(result.intent).toBe('affordability_question')
  })

  it('"Is it safe to spend £500 on a new laptop?"', async () => {
    const result = await classifyIntent('Is it safe to spend £500 on a new laptop?', NO_KEY)
    expect(result.intent).toBe('safe_to_spend')
  })
})

describe('classifyIntent — unusual_spending patterns', () => {
  it('"Were there any unexpected charges this month?"', async () => {
    const result = await classifyIntent('Were there any unexpected charges this month?', NO_KEY)
    expect(result.intent).toBe('unusual_spending')
  })

  it('"Flag any suspicious transactions"', async () => {
    const result = await classifyIntent('Flag any suspicious transactions', NO_KEY)
    expect(result.intent).toBe('unusual_spending')
  })
})

describe('classifyIntent — account_balance patterns', () => {
  it('"How much do I have in my account?"', async () => {
    const result = await classifyIntent('How much do I have in my account?', NO_KEY)
    expect(result.intent).toBe('account_balance')
  })

  it('"What are my available funds?"', async () => {
    const result = await classifyIntent('What are my available funds?', NO_KEY)
    expect(result.intent).toBe('account_balance')
  })
})

describe('classifyIntent — onboarding_help patterns', () => {
  it('"How do I connect my bank?"', async () => {
    const result = await classifyIntent('How do I connect my bank?', NO_KEY)
    expect(result.intent).toBe('onboarding_help')
  })

  it('"What can you do?"', async () => {
    const result = await classifyIntent('What can you do?', NO_KEY)
    expect(result.intent).toBe('onboarding_help')
  })

  it('"Help"', async () => {
    const result = await classifyIntent('Help', NO_KEY)
    expect(result.intent).toBe('onboarding_help')
  })
})

describe('classifyIntent — unknown intent', () => {
  it('returns unknown for unrecognised message', async () => {
    const result = await classifyIntent('Tell me a joke', NO_KEY)
    expect(result.intent).toBe('unknown')
  })

  it('returns unknown for empty-ish message', async () => {
    const result = await classifyIntent('ok', NO_KEY)
    expect(result.intent).toBe('unknown')
  })
})

// ── LLM fallback path ─────────────────────────────────────────────────────

describe('classifyIntent — LLM fallback path', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses LLM result when rules do not match and API key is provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"intent": "savings_query", "confidence": "high"}' }],
      }),
    }))

    const result = await classifyIntent('completely ambiguous message', 'sk-ant-test-key')
    expect(result.intent).toBe('savings_query')
    expect(result.method).toBe('llm')
  })

  it('falls back to unknown when LLM returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    const result = await classifyIntent('ambiguous message', 'sk-ant-test-key')
    expect(result.intent).toBe('unknown')
    expect(result.method).toBe('rules')
  })

  it('falls back to unknown when LLM fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const result = await classifyIntent('ambiguous message', 'sk-ant-test-key')
    expect(result.intent).toBe('unknown')
    expect(result.method).toBe('rules')
  })

  it('falls back to unknown when LLM returns invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'not valid json at all' }] }),
    }))

    const result = await classifyIntent('ambiguous message', 'sk-ant-test-key')
    expect(result.intent).toBe('unknown')
  })

  it('does not call fetch when no API key is provided', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await classifyIntent('ambiguous message', '')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('classifyIntent — new intents (Steps 14-27)', () => {
  // transaction_search
  it('transaction_search: "Show me my transactions at Tesco last month"', async () => {
    const r = await classifyIntent('Show me my transactions at Tesco last month', NO_KEY)
    expect(r.intent).toBe('transaction_search')
  })
  it('transaction_search: "Find my recent Amazon purchases"', async () => {
    const r = await classifyIntent('Find my recent Amazon purchases', NO_KEY)
    expect(r.intent).toBe('transaction_search')
  })

  // cash_flow
  it('cash_flow: "Will I run out of money before payday?"', async () => {
    const r = await classifyIntent('Will I run out of money before payday?', NO_KEY)
    expect(r.intent).toBe('cash_flow')
  })
  it('cash_flow: "Can I make it to payday?"', async () => {
    const r = await classifyIntent('Can I make it to payday?', NO_KEY)
    expect(r.intent).toBe('cash_flow')
  })

  // tax_year_summary
  it('tax_year_summary: "Show me my tax year summary"', async () => {
    const r = await classifyIntent('Show me my tax year summary', NO_KEY)
    expect(r.intent).toBe('tax_year_summary')
  })
  it('tax_year_summary: "What were my business expenses?"', async () => {
    const r = await classifyIntent('What were my business expenses?', NO_KEY)
    expect(r.intent).toBe('tax_year_summary')
  })

  // duplicate_detection
  it('duplicate_detection: "Have I been charged twice?"', async () => {
    const r = await classifyIntent('Have I been charged twice?', NO_KEY)
    expect(r.intent).toBe('duplicate_detection')
  })
  it('duplicate_detection: "Check for duplicate transactions"', async () => {
    const r = await classifyIntent('Check for duplicate transactions', NO_KEY)
    expect(r.intent).toBe('duplicate_detection')
  })

  // savings_simulation
  it('savings_simulation: "If I save £200/month how long to reach my goal?"', async () => {
    const r = await classifyIntent('If I save £200/month how long to reach my goal?', NO_KEY)
    expect(r.intent).toBe('savings_simulation')
  })
  it('savings_simulation: "If I cut eating out by £50 when will I save £2000?"', async () => {
    const r = await classifyIntent('If I cut eating out by £50 when will I save £2000?', NO_KEY)
    expect(r.intent).toBe('savings_simulation')
  })

  // fx_transactions
  it('fx_transactions: "How much did I spend abroad?"', async () => {
    const r = await classifyIntent('How much did I spend abroad?', NO_KEY)
    expect(r.intent).toBe('fx_transactions')
  })
  it('fx_transactions: "What are my FX fees?"', async () => {
    const r = await classifyIntent('What are my FX fees?', NO_KEY)
    expect(r.intent).toBe('fx_transactions')
  })

  // charity_tracker
  it('charity_tracker: "How much have I donated to charity?"', async () => {
    const r = await classifyIntent('How much have I donated to charity?', NO_KEY)
    expect(r.intent).toBe('charity_tracker')
  })
  it('charity_tracker: "Show me my Gift Aid donations"', async () => {
    const r = await classifyIntent('Show me my Gift Aid donations', NO_KEY)
    expect(r.intent).toBe('charity_tracker')
  })

  // credit_health
  it('credit_health: "How can I improve my credit score?"', async () => {
    const r = await classifyIntent('How can I improve my credit score?', NO_KEY)
    expect(r.intent).toBe('credit_health')
  })
  it('credit_health: "Tips for better credit rating"', async () => {
    const r = await classifyIntent('Tips for better credit rating', NO_KEY)
    expect(r.intent).toBe('credit_health')
  })

  // financial_health (existing but verify)
  it('financial_health: "What is my financial health score?"', async () => {
    const r = await classifyIntent('What is my financial health score?', NO_KEY)
    expect(r.intent).toBe('financial_health')
  })

  // spending_trends (existing)
  it('spending_trends: "How is my spending trending?"', async () => {
    const r = await classifyIntent('How is my spending trending?', NO_KEY)
    expect(r.intent).toBe('spending_trends')
  })

  // spending_forecast (existing)
  it('spending_forecast: "What is my spending forecast?"', async () => {
    const r = await classifyIntent('What is my spending forecast?', NO_KEY)
    expect(r.intent).toBe('spending_forecast')
  })
})
