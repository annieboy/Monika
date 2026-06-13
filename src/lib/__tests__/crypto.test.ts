/**
 * Security-critical crypto module tests.
 *
 * These verify the AES-256-GCM encrypt/decrypt round-trip, HMAC-SHA256 phone
 * hashing, webhook signature verification, and transaction dedup hashing.
 * Any regression here is a security issue — do not remove or weaken.
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  encrypt,
  decrypt,
  hashPhoneNumber,
  verifyHmacSignature,
  transactionDedupHash,
} from '../crypto.js'

const HEX_KEY_64 = 'a'.repeat(64) // 32-byte all-0xaa key
const PHONE = '447700900001'
const SECRET = 'test-secret-key-for-hmac-testing'

// ── AES-256-GCM ───────────────────────────────────────────────────────────────

describe('encrypt / decrypt', () => {
  it('round-trips arbitrary plaintext', () => {
    const plain = Buffer.from('Hello, Monika!', 'utf-8')
    const ciphertext = encrypt(plain, HEX_KEY_64)
    const recovered = decrypt(ciphertext, HEX_KEY_64)
    expect(recovered.toString('utf-8')).toBe('Hello, Monika!')
  })

  it('round-trips a UK phone number', () => {
    const plain = Buffer.from(PHONE, 'utf-8')
    const ciphertext = encrypt(plain, HEX_KEY_64)
    const recovered = decrypt(ciphertext, HEX_KEY_64)
    expect(recovered.toString('utf-8')).toBe(PHONE)
  })

  it('produces different ciphertext on every call (random nonce)', () => {
    const plain = Buffer.from('same plaintext')
    const c1 = encrypt(plain, HEX_KEY_64)
    const c2 = encrypt(plain, HEX_KEY_64)
    expect(c1.toString('hex')).not.toBe(c2.toString('hex'))
  })

  it('wire format is: 12-byte nonce + ciphertext + 16-byte auth tag', () => {
    const plain = Buffer.from('test')
    const ciphertext = encrypt(plain, HEX_KEY_64)
    // 12 (nonce) + 4 (plaintext, no padding in GCM) + 16 (tag) = 32
    expect(ciphertext.length).toBe(12 + 4 + 16)
  })

  it('throws when auth tag is tampered (integrity protection)', () => {
    const plain = Buffer.from('sensitive data')
    const ciphertext = encrypt(plain, HEX_KEY_64)
    // Flip last byte of auth tag
    ciphertext[ciphertext.length - 1] ^= 0xff
    expect(() => decrypt(ciphertext, HEX_KEY_64)).toThrow()
  })

  it('throws when ciphertext body is tampered', () => {
    const plain = Buffer.from('sensitive data')
    const ciphertext = encrypt(plain, HEX_KEY_64)
    // Flip byte in ciphertext body (after nonce, before tag)
    ciphertext[12] ^= 0x01
    expect(() => decrypt(ciphertext, HEX_KEY_64)).toThrow()
  })

  it('throws when wrong key is used for decryption', () => {
    const plain = Buffer.from('secret')
    const ciphertext = encrypt(plain, HEX_KEY_64)
    const wrongKey = 'b'.repeat(64)
    expect(() => decrypt(ciphertext, wrongKey)).toThrow()
  })

  it('works with empty key (zero key fallback for dev)', () => {
    const plain = Buffer.from('dev-only')
    const ciphertext = encrypt(plain, '')
    const recovered = decrypt(ciphertext, '')
    expect(recovered.toString('utf-8')).toBe('dev-only')
  })

  it('round-trips binary data', () => {
    const plain = Buffer.from([0x00, 0xff, 0x42, 0x01, 0x80])
    const recovered = decrypt(encrypt(plain, HEX_KEY_64), HEX_KEY_64)
    expect(recovered).toEqual(plain)
  })
})

// ── Phone hashing ─────────────────────────────────────────────────────────────

describe('hashPhoneNumber', () => {
  it('returns a 64-character hex string', () => {
    const hash = hashPhoneNumber(PHONE, SECRET)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same phone + secret', () => {
    expect(hashPhoneNumber(PHONE, SECRET)).toBe(hashPhoneNumber(PHONE, SECRET))
  })

  it('produces different hashes for different phones', () => {
    expect(hashPhoneNumber('447700900001', SECRET)).not.toBe(hashPhoneNumber('447700900002', SECRET))
  })

  it('produces different hashes for the same phone with different secrets (keyed HMAC)', () => {
    expect(hashPhoneNumber(PHONE, 'secret-a')).not.toBe(hashPhoneNumber(PHONE, 'secret-b'))
  })

  it('falls back to bare SHA-256 when no secret (dev mode)', () => {
    const hash = hashPhoneNumber(PHONE, '')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keyed HMAC and bare SHA-256 produce different results for same input', () => {
    expect(hashPhoneNumber(PHONE, SECRET)).not.toBe(hashPhoneNumber(PHONE, ''))
  })

  it('never returns the raw phone number', () => {
    expect(hashPhoneNumber(PHONE, SECRET)).not.toContain(PHONE)
  })
})

// ── HMAC webhook signature verification ───────────────────────────────────────

describe('verifyHmacSignature', () => {
  function makeSignature(body: Buffer, secret: string): string {
    const hex = createHmac('sha256', secret).update(body).digest('hex')
    return `sha256=${hex}`
  }

  it('accepts a valid signature', () => {
    const body = Buffer.from('{"test": true}')
    const sig = makeSignature(body, 'app-secret')
    expect(verifyHmacSignature(body, sig, 'app-secret')).toBe(true)
  })

  it('rejects a signature with wrong secret', () => {
    const body = Buffer.from('{"test": true}')
    const sig = makeSignature(body, 'right-secret')
    expect(verifyHmacSignature(body, sig, 'wrong-secret')).toBe(false)
  })

  it('rejects a tampered body', () => {
    const body = Buffer.from('{"test": true}')
    const sig = makeSignature(body, 'app-secret')
    const tamperedBody = Buffer.from('{"test": false}')
    expect(verifyHmacSignature(tamperedBody, sig, 'app-secret')).toBe(false)
  })

  it('rejects a signature without sha256= prefix', () => {
    const body = Buffer.from('body')
    const hex = createHmac('sha256', 'secret').update(body).digest('hex')
    expect(verifyHmacSignature(body, hex, 'secret')).toBe(false)
  })

  it('rejects an empty signature header', () => {
    const body = Buffer.from('body')
    expect(verifyHmacSignature(body, '', 'secret')).toBe(false)
  })

  it('rejects a truncated signature (length mismatch)', () => {
    const body = Buffer.from('body')
    expect(verifyHmacSignature(body, 'sha256=deadbeef', 'secret')).toBe(false)
  })
})

// ── Transaction dedup hash ─────────────────────────────────────────────────────

describe('transactionDedupHash', () => {
  const DATE = new Date('2024-03-15T12:00:00Z')

  it('returns a 64-character hex string', () => {
    const hash = transactionDedupHash('acc-1', DATE, '25.00', 'Netflix')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const h1 = transactionDedupHash('acc-1', DATE, '25.00', 'Netflix')
    const h2 = transactionDedupHash('acc-1', DATE, '25.00', 'Netflix')
    expect(h1).toBe(h2)
  })

  it('differs when any field changes', () => {
    const base = transactionDedupHash('acc-1', DATE, '25.00', 'Netflix')
    expect(transactionDedupHash('acc-2', DATE, '25.00', 'Netflix')).not.toBe(base)
    expect(transactionDedupHash('acc-1', new Date('2024-03-16'), '25.00', 'Netflix')).not.toBe(base)
    expect(transactionDedupHash('acc-1', DATE, '26.00', 'Netflix')).not.toBe(base)
    expect(transactionDedupHash('acc-1', DATE, '25.00', 'Disney+')).not.toBe(base)
  })

  it('uses only the date portion of the timestamp (YYYY-MM-DD)', () => {
    const morning = new Date('2024-03-15T08:00:00Z')
    const evening = new Date('2024-03-15T20:00:00Z')
    expect(transactionDedupHash('acc-1', morning, '25.00', 'Netflix'))
      .toBe(transactionDedupHash('acc-1', evening, '25.00', 'Netflix'))
  })
})
