import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FinancialSnapshot } from '../../analytics/analytics.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { answerWithAI } from '../conversational.js'

const SNAPSHOT: FinancialSnapshot = {
  currentBalances: [{ displayName: 'Current', accountType: 'CURRENT', currentBalance: 1200, availableBalance: 1200 }],
  totalBalance: 1200,
  thisMonthSpend: 800,
  lastMonthSpend: 750,
  monthlyIncome: 2500,
  savingsRate: 20,
  topCategories: [],
  subscriptions: [],
  recentTransactions: [],
  totalSubscriptions: 0,
}

function mockSuccess(text: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  })
}

const FULL_SNAPSHOT: FinancialSnapshot = {
  currentBalances: [{ displayName: 'Current', accountType: 'CURRENT', currentBalance: 1200, availableBalance: 1200 }],
  totalBalance: 1200,
  thisMonthSpend: 800,
  lastMonthSpend: 750,
  monthlyIncome: 2500,
  savingsRate: 20,
  topCategories: [
    { category: 'groceries', total: 240, transactionCount: 12 },
    { category: 'transport', total: 85, transactionCount: 8 },
  ],
  subscriptions: [
    { merchantName: 'Netflix', monthlyAmount: 15.99 } as never,
    { merchantName: 'Spotify', monthlyAmount: 9.99 } as never,
  ],
  recentTransactions: [
    { date: '2024-06-01', merchant: 'Tesco', amount: 42.50, category: 'groceries' },
    { date: '2024-06-02', merchant: 'TfL', amount: 5.00, category: null as never },
  ],
  totalSubscriptions: 25.98,
}

describe('answerWithAI', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when API call fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const result = await answerWithAI('what is my balance?', SNAPSHOT, 'key')
    expect(result).toBeNull()
  })

  it('returns null when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 })
    const result = await answerWithAI('what is my balance?', SNAPSHOT, 'key')
    expect(result).toBeNull()
  })

  it('returns AI text on success', async () => {
    mockSuccess('Your balance is £1,200.')
    const result = await answerWithAI('what is my balance?', SNAPSHOT, 'key')
    expect(result).toBe('Your balance is £1,200.')
  })

  it('sends a single user message when no history', async () => {
    mockSuccess('reply')
    await answerWithAI('my question', SNAPSHOT, 'key')

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: { role: string; content: string }[]
    }
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages[0]?.content).toContain('my question')
  })

  it('includes conversation history when provided', async () => {
    mockSuccess('follow-up reply')
    const history = [
      { role: 'user' as const, content: 'first question' },
      { role: 'assistant' as const, content: 'first answer' },
    ]
    await answerWithAI('follow-up', SNAPSHOT, 'key', history)

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: { role: string; content: string }[]
    }
    // history (2) + current message (1) = 3
    expect(body.messages).toHaveLength(3)
    expect(body.messages[2]?.role).toBe('user')
    expect(body.messages[2]?.content).toBe('follow-up')
  })

  it('prepends financial snapshot to the first history message', async () => {
    mockSuccess('reply')
    const history = [
      { role: 'user' as const, content: 'original question' },
      { role: 'assistant' as const, content: 'original answer' },
    ]
    await answerWithAI('new question', SNAPSHOT, 'key', history)

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: { role: string; content: string }[]
    }
    // First message should contain the snapshot data
    expect(body.messages[0]?.content).toContain('FINANCIAL DATA')
    expect(body.messages[0]?.content).toContain('original question')
  })

  it('builds a prompt that includes categories, subscriptions, and transactions', async () => {
    mockSuccess('context-aware reply')
    await answerWithAI('how am I doing?', FULL_SNAPSHOT, 'key')
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: { role: string; content: string }[]
    }
    const content = body.messages[0]?.content ?? ''
    expect(content).toContain('groceries')
    expect(content).toContain('Netflix')
    expect(content).toContain('Tesco')
  })

  it('current message is always the last message', async () => {
    mockSuccess('reply')
    const history = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'q2' },
      { role: 'assistant' as const, content: 'a2' },
    ]
    await answerWithAI('latest question', SNAPSHOT, 'key', history)

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: { role: string; content: string }[]
    }
    const last = body.messages[body.messages.length - 1]
    expect(last?.role).toBe('user')
    expect(last?.content).toBe('latest question')
  })
})
