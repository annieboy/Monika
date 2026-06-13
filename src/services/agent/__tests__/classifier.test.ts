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
