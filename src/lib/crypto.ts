import { createHmac, createHash, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// ── HMAC webhook verification ──────────────────────────────────────────────

/**
 * Verifies a Meta WhatsApp webhook HMAC-SHA256 signature.
 * The signature header is "sha256=<hex>"; we strip the prefix before comparing.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyHmacSignature(
  rawBody: Buffer,
  signatureHeader: string,
  appSecret: string,
): boolean {
  if (!signatureHeader.startsWith('sha256=')) return false

  const theirHex = signatureHeader.slice('sha256='.length)
  const ourHmac = createHmac('sha256', appSecret).update(rawBody).digest()

  let theirBytes: Buffer
  try {
    theirBytes = Buffer.from(theirHex, 'hex')
  } catch {
    return false
  }

  // Lengths must match before timingSafeEqual (it throws on mismatch)
  if (ourHmac.length !== theirBytes.length) return false

  return timingSafeEqual(ourHmac, theirBytes)
}

// ── Phone number hashing ───────────────────────────────────────────────────

/**
 * Hashes a phone number with HMAC-SHA256, keyed by SECRET_KEY.
 *
 * Using a keyed HMAC (vs bare SHA-256) prevents rainbow table attacks:
 * an attacker who dumps the database cannot pre-compute hashes for common
 * UK phone numbers without also knowing the application secret.
 *
 * Falls back to bare SHA-256 when SECRET_KEY is empty (dev/test only).
 * The raw phone number is NEVER stored — only this hash.
 */
export function hashPhoneNumber(phone: string, secretKey = ''): string {
  if (secretKey) {
    return createHmac('sha256', secretKey).update(phone).digest('hex')
  }
  // Dev/test fallback — deterministic but not secret-keyed
  return createHash('sha256').update(phone).digest('hex')
}

// ── AES-256-GCM encryption (application-layer, for tokens stored in DB) ────

const NONCE_BYTES = 12  // 96-bit nonce, standard for GCM
const TAG_BYTES = 16    // 128-bit auth tag

/**
 * Derives a 32-byte key Buffer from a 64-char hex string.
 * Falls back to a zero key when encryptionKeyHex is empty — for local
 * development only; in production ENCRYPTION_KEY must always be set.
 */
function keyFromHex(encryptionKeyHex: string): Buffer {
  if (encryptionKeyHex.length === 64) {
    return Buffer.from(encryptionKeyHex, 'hex')
  }
  // Zero key — plaintext-equivalent, safe only in non-production environments
  return Buffer.alloc(32, 0)
}

/**
 * Encrypts plaintext bytes with AES-256-GCM.
 * Wire format: [ nonce (12 bytes) | ciphertext | auth tag (16 bytes) ]
 * The returned Buffer is what gets stored in a Prisma `Bytes` field.
 */
export function encrypt(plaintext: Buffer, encryptionKeyHex: string): Buffer {
  const key = keyFromHex(encryptionKeyHex)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ciphertext, tag])
}

/**
 * Decrypts a Buffer produced by encrypt().
 * Throws if the auth tag doesn't match (tampered ciphertext).
 */
export function decrypt(encrypted: Buffer, encryptionKeyHex: string): Buffer {
  const key = keyFromHex(encryptionKeyHex)
  const nonce = encrypted.subarray(0, NONCE_BYTES)
  const tag = encrypted.subarray(encrypted.length - TAG_BYTES)
  const ciphertext = encrypted.subarray(NONCE_BYTES, encrypted.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

// ── Dedup hash ─────────────────────────────────────────────────────────────

/**
 * Deterministic SHA-256 hash for transaction deduplication.
 * Computed from stable fields that survive re-delivery by the provider.
 */
export function transactionDedupHash(
  accountId: string,
  transactionDate: Date,
  amount: string,
  rawDescription: string,
): string {
  const input = `${accountId}:${transactionDate.toISOString().slice(0, 10)}:${amount}:${rawDescription}`
  return createHash('sha256').update(input).digest('hex')
}
