/**
 * HMAC-signed OAuth state parameter.
 *
 * TrueLayer redirects the user back to /banking/callback with the same
 * state value we sent. We encode the userId in state so we can recover
 * it in the callback without a database roundtrip.
 *
 * Format (before base64url): <userId>|<16-byte-hex-nonce>|<ts-hex>|<hmac-base64url>
 * The HMAC covers everything before the last pipe.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const STATE_MAX_AGE_MS = 15 * 60 * 1000 // 15 minutes — matches token TTL

export function encodeOAuthState(userId: string, secretKey: string): string {
  const nonce = randomBytes(16).toString('hex')
  const ts = Date.now().toString(36)
  const payload = `${userId}|${nonce}|${ts}`
  const sig = createHmac('sha256', secretKey).update(payload).digest('base64url')
  return Buffer.from(`${payload}|${sig}`).toString('base64url')
}

/**
 * Returns the userId if state is valid and unexpired, null otherwise.
 * Never throws.
 */
export function decodeOAuthState(state: string, secretKey: string): string | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf-8')
    const lastPipe = decoded.lastIndexOf('|')
    if (lastPipe === -1) return null

    const payload = decoded.slice(0, lastPipe)
    const sig = decoded.slice(lastPipe + 1)

    const expected = createHmac('sha256', secretKey).update(payload).digest('base64url')
    const sigBuf = Buffer.from(sig)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null

    const parts = payload.split('|')
    if (parts.length !== 3) return null
    const [userId, , ts] = parts
    if (!userId || !ts) return null

    if (Date.now() - parseInt(ts, 36) > STATE_MAX_AGE_MS) return null

    return userId
  } catch {
    return null
  }
}
