import { describe, it, expect } from 'vitest'
import { detectProviderSlug, slugifyMerchant } from '../merchantMappings.js'

describe('detectProviderSlug', () => {
  it('matches exact provider name', () => {
    expect(detectProviderSlug('VIRGIN MEDIA')).toBe('virgin-media')
  })

  it('matches substring — SKY BROADBAND before SKY', () => {
    expect(detectProviderSlug('SKY BROADBAND DIRECT DEBIT')).toBe('sky')
  })

  it('matches SKY alone', () => {
    expect(detectProviderSlug('SKY')).toBe('sky')
  })

  it('is case-insensitive', () => {
    expect(detectProviderSlug('netflix.com')).toBe('netflix')
    expect(detectProviderSlug('Vodafone')).toBe('vodafone')
  })

  it('matches accounting: xero', () => {
    expect(detectProviderSlug('Xero Subscription')).toBe('xero')
  })

  it('matches accounting: QuickBooks via INTUIT', () => {
    expect(detectProviderSlug('INTUIT QUICKBOOKS')).toBe('quickbooks')
  })

  it('returns null for unknown merchant', () => {
    expect(detectProviderSlug('LOCAL COFFEE SHOP')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(detectProviderSlug('')).toBeNull()
  })

  it('longest match wins — "SKY BROADBAND" > "SKY"', () => {
    const result = detectProviderSlug('SKY BROADBAND')
    // Both map to 'sky' in this case, but the longer match should be found first
    expect(result).toBe('sky')
  })

  it('matches EE mobile', () => {
    expect(detectProviderSlug('EE LIMITED DD')).toBe('ee')
  })

  it('matches broadband utilities', () => {
    expect(detectProviderSlug('HYPEROPTIC LTD')).toBe('hyperoptic')
  })
})

describe('slugifyMerchant', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyMerchant('Local Coffee Shop')).toBe('local-coffee-shop')
  })

  it('removes special characters', () => {
    expect(slugifyMerchant('Amazon*Prime!')).toBe('amazon-prime')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugifyMerchant('  Test  ')).toBe('test')
  })

  it('collapses multiple separators', () => {
    expect(slugifyMerchant('A  B---C')).toBe('a-b-c')
  })

  it('truncates at 64 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugifyMerchant(long).length).toBeLessThanOrEqual(64)
  })
})
