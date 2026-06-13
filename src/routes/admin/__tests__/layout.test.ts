import { describe, it, expect } from 'vitest'
import { layout } from '../layout.js'

describe('admin layout sidebar navigation', () => {
  const html = layout('Test', '<p>body</p>')

  it('includes Offers link', () => {
    expect(html).toContain('href="/admin/offers"')
  })

  it('includes Categories link', () => {
    expect(html).toContain('href="/admin/categories"')
  })

  it('includes Opportunities link', () => {
    expect(html).toContain('href="/admin/opportunities"')
  })

  it('includes Conversations link', () => {
    expect(html).toContain('href="/admin/conversations"')
  })

  it('includes existing core links', () => {
    expect(html).toContain('href="/admin"')
    expect(html).toContain('href="/admin/users"')
    expect(html).toContain('href="/admin/transactions"')
    expect(html).toContain('href="/admin/audit"')
  })
})
