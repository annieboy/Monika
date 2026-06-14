import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getTaxYearDates, getTaxYearSummary, formatTaxYearSummary } from '../taxYearService.js'

// ── getTaxYearDates ───────────────────────────────────────────────────────────

describe('getTaxYearDates', () => {
  it('returns current tax year when date is after 6 April', () => {
    const { from, to, label } = getTaxYearDates(new Date('2026-06-15'))
    expect(from).toEqual(new Date(2026, 3, 6))
    expect(to.getFullYear()).toBe(2027)
    expect(label).toBe('2026/27')
  })

  it('returns previous tax year when date is before 6 April', () => {
    const { from, to, label } = getTaxYearDates(new Date('2026-03-01'))
    expect(from).toEqual(new Date(2025, 3, 6))
    expect(to.getFullYear()).toBe(2026)
    expect(label).toBe('2025/26')
  })

  it('correctly includes 6 April itself in new tax year', () => {
    const { label } = getTaxYearDates(new Date('2026-04-06'))
    expect(label).toBe('2026/27')
  })

  it('correctly puts 5 April in previous tax year', () => {
    const { label } = getTaxYearDates(new Date('2026-04-05'))
    expect(label).toBe('2025/26')
  })
})

// ── getTaxYearSummary ─────────────────────────────────────────────────────────

function makePrisma(opts: {
  totalIncome?: number
  totalSpend?: number
  categories?: Array<{ category: string; amount: number }>
} = {}) {
  let aggregateCall = 0
  return {
    transaction: {
      aggregate: vi.fn().mockImplementation(() => {
        aggregateCall++
        if (aggregateCall === 1) return Promise.resolve({ _sum: { amount: opts.totalIncome ?? 3000 } })
        return Promise.resolve({ _sum: { amount: -(opts.totalSpend ?? 2000) } })
      }),
      groupBy: vi.fn().mockResolvedValue(
        (opts.categories ?? []).map(c => ({
          category: c.category,
          _sum: { amount: -c.amount },
        })),
      ),
    },
  } as unknown as PrismaClient
}

describe('getTaxYearSummary', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns correct tax year label', async () => {
    vi.setSystemTime(new Date('2026-06-15'))
    const prisma = makePrisma()
    const s = await getTaxYearSummary(prisma, 'u1', new Date('2026-06-15'))
    expect(s.taxYear).toBe('2026/27')
  })

  it('returns income and spend totals', async () => {
    vi.setSystemTime(new Date('2026-06-15'))
    const prisma = makePrisma({ totalIncome: 48000, totalSpend: 30000 })
    const s = await getTaxYearSummary(prisma, 'u1', new Date('2026-06-15'))
    expect(s.totalIncome).toBe(48000)
    expect(s.totalSpend).toBe(30000)
  })

  it('identifies potential expense categories', async () => {
    vi.setSystemTime(new Date('2026-06-15'))
    const prisma = makePrisma({
      categories: [
        { category: 'transport', amount: 500 },
        { category: 'eating out', amount: 300 },
        { category: 'entertainment', amount: 200 },
      ],
    })
    const s = await getTaxYearSummary(prisma, 'u1', new Date('2026-06-15'))
    expect(s.potentialExpenseCategories).toContain('transport')
    expect(s.potentialExpenseCategories).toContain('eating out')
    expect(s.potentialExpenseCategories).not.toContain('entertainment')
  })
})

// ── formatTaxYearSummary ──────────────────────────────────────────────────────

describe('formatTaxYearSummary', () => {
  const sample = {
    taxYear: '2025/26',
    fromDate: new Date(2025, 3, 6),
    toDate: new Date(2026, 3, 5, 23, 59, 59, 999),
    totalIncome: 50000,
    totalSpend: 32000,
    categoryBreakdown: [
      { category: 'Groceries', total: 5000 },
      { category: 'Transport', total: 2000 },
    ],
    potentialExpenseCategories: ['Transport'],
  }

  it('includes tax year label', () => {
    const out = formatTaxYearSummary(sample)
    expect(out).toMatch(/2025\/26/)
  })

  it('shows income and spend totals', () => {
    const out = formatTaxYearSummary(sample)
    expect(out).toMatch(/£50,000\.00/)
    expect(out).toMatch(/£32,000\.00/)
  })

  it('lists category breakdown', () => {
    const out = formatTaxYearSummary(sample)
    expect(out).toMatch(/Groceries/)
    expect(out).toMatch(/Transport/)
  })

  it('shows potential business expense section', () => {
    const out = formatTaxYearSummary(sample)
    expect(out).toMatch(/business expenses/i)
    expect(out).toMatch(/Transport/)
  })

  it('includes accountant disclaimer', () => {
    const out = formatTaxYearSummary(sample)
    expect(out).toMatch(/accountant/i)
  })

  it('truncates category list at 10', () => {
    const manyCategories = Array.from({ length: 15 }, (_, i) => ({ category: `Cat${i}`, total: 100 }))
    const out = formatTaxYearSummary({ ...sample, categoryBreakdown: manyCategories, potentialExpenseCategories: [] })
    expect(out).toMatch(/5 more categories/)
  })
})
