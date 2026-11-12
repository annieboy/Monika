import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ ALLOWED_WHATSAPP_NUMBERS: '' }))
vi.mock('../../../config.js', () => ({ config: cfg }))

import { isAllowedNumber } from '../allowlist.js'

describe('isAllowedNumber (private-beta gate)', () => {
  beforeEach(() => { cfg.ALLOWED_WHATSAPP_NUMBERS = '' })

  it('allows everyone when the allowlist is empty', () => {
    expect(isAllowedNumber('447700900000')).toBe(true)
    expect(isAllowedNumber('447711111111')).toBe(true)
  })

  it('allows a listed number and blocks others', () => {
    cfg.ALLOWED_WHATSAPP_NUMBERS = '447700900000,447700900001'
    expect(isAllowedNumber('447700900000')).toBe(true)
    expect(isAllowedNumber('447700900001')).toBe(true)
    expect(isAllowedNumber('447722222222')).toBe(false)
  })

  it('ignores formatting (spaces, +, dashes)', () => {
    cfg.ALLOWED_WHATSAPP_NUMBERS = '+44 7700 900000'
    expect(isAllowedNumber('447700900000')).toBe(true)
    expect(isAllowedNumber('44-7700-900000')).toBe(true)
  })

  it('matches on suffix so country-code prefixes still work', () => {
    cfg.ALLOWED_WHATSAPP_NUMBERS = '7700900000'
    expect(isAllowedNumber('447700900000')).toBe(true)
  })

  it('treats undefined allowlist as open', () => {
    // @ts-expect-error — simulating a config mock without the field
    cfg.ALLOWED_WHATSAPP_NUMBERS = undefined
    expect(isAllowedNumber('447700900000')).toBe(true)
  })
})
