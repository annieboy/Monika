/**
 * Private-beta allowlist gate for inbound WhatsApp numbers.
 *
 * When ALLOWED_WHATSAPP_NUMBERS is set (comma-separated), only those numbers
 * may use Monika; empty means open to everyone. Kept in its own module so it
 * can be unit-tested without loading the whole webhook dependency graph.
 */
import { config } from '../../config.js'

export function isAllowedNumber(phone: string): boolean {
  const raw = (config.ALLOWED_WHATSAPP_NUMBERS ?? '').trim()
  if (!raw) return true
  const digits = phone.replace(/\D/g, '')
  return raw
    .split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter((n) => n.length > 0)
    .some((allowed) => digits === allowed || digits.endsWith(allowed) || allowed.endsWith(digits))
}
