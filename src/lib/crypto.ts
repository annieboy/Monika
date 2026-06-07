import { createHmac, createHash, timingSafeEqual } from 'crypto'

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

/**
 * Hashes a phone number with SHA-256.
 * The raw phone number is NEVER stored — only this hash.
 */
export function hashPhoneNumber(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}
