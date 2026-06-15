import { describe, it, expect } from 'vitest'
import { recommendRewardCard, isRewardCardRequest } from '../rewardCardService.js'

describe('recommendRewardCard', () => {
  it('returns connect-bank message when no spend data', () => {
    const result = recommendRewardCard([])
    expect(result).toMatch(/connect.*bank|spending patterns/i)
  })

  it('recommends supermarket card for high grocery spend', () => {
    const result = recommendRewardCard([
      { category: 'groceries', monthly: 600 },
      { category: 'transport', monthly: 100 },
    ])
    expect(result).toMatch(/supermarket|groceries/i)
    expect(result).toMatch(/year/)
  })

  it('recommends travel card when travel spend is dominant', () => {
    const result = recommendRewardCard([
      { category: 'travel', monthly: 500 },
      { category: 'flights', monthly: 300 },
      { category: 'groceries', monthly: 100 },
    ])
    expect(result).toMatch(/travel|Avios/i)
  })

  it('shows top 3 card options', () => {
    const result = recommendRewardCard([
      { category: 'eating out', monthly: 400 },
      { category: 'groceries', monthly: 200 },
    ])
    // Should show multiple card options
    expect((result.match(/Estimated reward/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('includes responsible credit use warning', () => {
    const result = recommendRewardCard([{ category: 'groceries', monthly: 300 }])
    expect(result).toMatch(/pay.*balance.*full|interest/i)
  })

  it('includes commission disclosure', () => {
    const result = recommendRewardCard([{ category: 'groceries', monthly: 300 }])
    expect(result).toMatch(/commission/i)
  })
})

describe('isRewardCardRequest', () => {
  it('matches reward card queries', () => {
    expect(isRewardCardRequest('which credit card gives the best cashback?')).toBe(true)
    expect(isRewardCardRequest('recommend a reward card for me')).toBe(true)
    expect(isRewardCardRequest('best travel credit card?')).toBe(true)
    expect(isRewardCardRequest('which card earns the most points?')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(isRewardCardRequest('how much did I spend on food?')).toBe(false)
    expect(isRewardCardRequest('what is my balance?')).toBe(false)
  })
})
