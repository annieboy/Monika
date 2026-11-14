import { describe, it, expect } from 'vitest'
import { parseBoolEnv } from '../config.js'

describe('parseBoolEnv', () => {
  it('returns the default when unset or empty', () => {
    expect(parseBoolEnv(undefined, true)).toBe(true)
    expect(parseBoolEnv(undefined, false)).toBe(false)
    expect(parseBoolEnv('', true)).toBe(true)
    expect(parseBoolEnv('   ', false)).toBe(false)
  })

  it('treats false/0/off/no (any case, trimmed) as false', () => {
    for (const v of ['false', 'FALSE', '0', 'off', 'OFF', 'no', ' No ']) {
      expect(parseBoolEnv(v, true)).toBe(false)
    }
  })

  it('treats anything else as true', () => {
    for (const v of ['true', 'TRUE', '1', 'on', 'yes', 'enabled']) {
      expect(parseBoolEnv(v, false)).toBe(true)
    }
  })
})
