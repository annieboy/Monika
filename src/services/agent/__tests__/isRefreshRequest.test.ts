import { describe, it, expect } from 'vitest'
import { isRefreshRequest } from '../router.js'

describe('isRefreshRequest', () => {
  it('recognises refresh/update phrasings', () => {
    expect(isRefreshRequest('refresh')).toBe(true)
    expect(isRefreshRequest('refresh my account')).toBe(true)
    expect(isRefreshRequest('update my account')).toBe(true)
    expect(isRefreshRequest('sync my data')).toBe(true)
    expect(isRefreshRequest('get the latest')).toBe(true)
    expect(isRefreshRequest('up to date balance')).toBe(true)
    expect(isRefreshRequest('check now')).toBe(true)
    expect(isRefreshRequest('resync')).toBe(true)
  })

  it('does not fire on ordinary questions', () => {
    expect(isRefreshRequest("what's my balance?")).toBe(false)
    expect(isRefreshRequest('how much did I spend this month')).toBe(false)
    expect(isRefreshRequest('show my transactions')).toBe(false)
  })
})
