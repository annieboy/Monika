import { describe, it, expect } from 'vitest'
import { resolveRange, TOOLS } from '../agenticHandler.js'

describe('resolveRange (flexible agent date windows)', () => {
  it('uses an explicit from/to range when given, overriding period', () => {
    const r = resolveRange({ from: '2026-06-01', to: '2026-08-31', period: 'this_month' })
    expect(r.from.getFullYear()).toBe(2026)
    expect(r.from.getMonth()).toBe(5) // June
    expect(r.to.getMonth()).toBe(7) // August
    // `to` is inclusive — pushed to the end of the day
    expect(r.to.getHours()).toBeGreaterThanOrEqual(23)
    expect(r.label).toMatch(/Jun 2026 to .*Aug 2026/)
  })

  it('treats a single day (from === to) as that one day with a day label', () => {
    const r = resolveRange({ from: '2026-11-03', to: '2026-11-03' })
    expect(r.from.getDate()).toBe(3)
    expect(r.to.getDate()).toBe(3)
    expect(r.to.getHours()).toBeGreaterThanOrEqual(23) // end of day
    expect(r.label).toMatch(/3 Nov 2026/)
    expect(r.label).not.toMatch(/ to /) // single day, not a range
  })

  it('falls back to the named period when no dates are given', () => {
    const r = resolveRange({ period: 'last_month' })
    expect(r.label).toBe('last month')
  })

  it('falls back to the per-tool default when neither dates nor period given', () => {
    const r = resolveRange({}, 'this_financial_year')
    expect(r.label).toBe('this financial year')
  })

  it('ignores an unparseable date and falls back to the period', () => {
    const r = resolveRange({ from: 'not-a-date', period: 'this_year' })
    expect(r.label).toBe('this year')
  })
})

describe('agent toolset coverage', () => {
  it('exposes the new problem-solving tools', () => {
    const names = TOOLS.map(t => t.name)
    expect(names).toContain('get_safe_to_spend')
    expect(names).toContain('get_income_from_payer')
    expect(names).toContain('get_charitable_giving')
    expect(names).toContain('get_net_worth')
  })

  it('lets time-scoped tools accept explicit from/to dates', () => {
    const spend = TOOLS.find(t => t.name === 'get_spending')!
    const props = (spend.input_schema as { properties: Record<string, unknown> }).properties
    expect(props['from']).toBeDefined()
    expect(props['to']).toBeDefined()
    expect(props['period']).toBeDefined()
  })
})
