import { describe, it, expect } from 'vitest'
import { categoriseByMerchant, inferCategory, normaliseDescription } from '../categorise.js'

describe('categoriseByMerchant', () => {
  it('categorises supermarkets as groceries', () => {
    expect(categoriseByMerchant('TESCO STORES 1234')).toBe('groceries')
    expect(categoriseByMerchant('Sainsburys S/MKT')).toBe('groceries')
    expect(categoriseByMerchant('ALDI')).toBe('groceries')
  })

  it('categorises takeaways/coffee as restaurants', () => {
    expect(categoriseByMerchant('DELIVEROO')).toBe('restaurants')
    expect(categoriseByMerchant('COSTA COFFEE')).toBe('restaurants')
    expect(categoriseByMerchant('Nando\'s')).toBe('restaurants')
  })

  it('categorises transport', () => {
    expect(categoriseByMerchant('TFL TRAVEL CH')).toBe('transport')
    expect(categoriseByMerchant('UBER *TRIP')).toBe('transport')
    expect(categoriseByMerchant('SHELL PETROL')).toBe('transport')
  })

  it('categorises streaming/gym as subscriptions', () => {
    expect(categoriseByMerchant('NETFLIX.COM')).toBe('subscriptions')
    expect(categoriseByMerchant('PureGym Ltd')).toBe('subscriptions')
  })

  it('categorises utilities/telecom as bills', () => {
    expect(categoriseByMerchant('BRITISH GAS')).toBe('bills')
    expect(categoriseByMerchant('VODAFONE LTD')).toBe('bills')
  })

  it('returns undefined for unknown merchants', () => {
    expect(categoriseByMerchant('SOME RANDOM LOCAL SHOP')).toBeUndefined()
    expect(categoriseByMerchant(null)).toBeUndefined()
    expect(categoriseByMerchant('')).toBeUndefined()
  })
})

describe('normaliseDescription', () => {
  it('strips bank noise to expose the merchant token', () => {
    expect(normaliseDescription('CARD PAYMENT TO TESCO STORES 2847 ON 05/11')).toContain('tesco')
    expect(normaliseDescription('DIRECT DEBIT BRITISH GAS 123456')).toContain('british gas')
    expect(normaliseDescription('CARD PAYMENT TO TESCO STORES 2847 ON 05/11')).not.toMatch(/card payment/)
  })

  it('lets a noisy statement line categorise correctly', () => {
    expect(categoriseByMerchant(normaliseDescription('POS PURCHASE GREGGS PLC 4471 LONDON'))).toBe('restaurants')
  })
})

describe('inferCategory (combined signals)', () => {
  it('prefers a known merchant name', () => {
    expect(inferCategory({ merchantName: 'Waitrose' })).toBe('groceries')
  })

  it('falls back to MCC when the name is unknown', () => {
    // 5411 = grocery stores/supermarkets, 5812 = eating places, 5912 = pharmacy
    expect(inferCategory({ merchantName: 'LOCAL CORNER MKT', mcc: '5411' })).toBe('groceries')
    expect(inferCategory({ merchantName: 'JOES DINER', mcc: '5812' })).toBe('restaurants')
    expect(inferCategory({ description: 'something', mcc: '5912' })).toBe('health')
  })

  it("uses TrueLayer's classification taxonomy when present", () => {
    expect(inferCategory({ classification: ['Food & Dining', 'Restaurants'] })).toBe('restaurants')
    expect(inferCategory({ classification: ['Shopping', 'Groceries'] })).toBe('groceries')
    expect(inferCategory({ classification: 'Gifts & Donations' })).toBe('charity')
  })

  it('falls back to a de-noised description', () => {
    expect(inferCategory({ description: 'CARD PAYMENT TO NANDOS 1122 ON 02/11' })).toBe('restaurants')
  })

  it('returns undefined when no signal resolves', () => {
    expect(inferCategory({ merchantName: 'UNKNOWN XYZ', description: 'ref 99', mcc: '9999' })).toBeUndefined()
    expect(inferCategory({})).toBeUndefined()
  })

  it('treats UK religious giving (church/chapel) as charity', () => {
    expect(inferCategory({ merchantName: 'Winners Chapel Intl' })).toBe('charity')
  })
})
