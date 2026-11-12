import { describe, it, expect } from 'vitest'
import { categoriseByMerchant } from '../categorise.js'

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
