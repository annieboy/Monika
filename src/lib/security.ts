/**
 * Security middleware and helpers.
 *
 * Provides:
 *   - addSecurityHeaders: sets standard security headers on all replies
 *   - validateWebhookContentType: ensures webhook POSTs are JSON
 *   - MAX_WEBHOOK_PAYLOAD_BYTES: enforced payload size cap
 *
 * Applied at app level in server.ts — not route-by-route.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024  // 64 KB

/** Registers a global onSend hook that adds security headers to every reply. */
export function addSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', (_request: FastifyRequest, reply: FastifyReply, _payload, done) => {
    void reply.header('X-Content-Type-Options', 'nosniff')
    void reply.header('X-Frame-Options', 'DENY')
    void reply.header('X-XSS-Protection', '1; mode=block')
    void reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    void reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // Remove server identification
    void reply.removeHeader('X-Powered-By')
    done()
  })
}

/** Validates that a POST to a webhook path has the correct Content-Type. */
export function validateWebhookContentType(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (request.method !== 'POST') return true
  const ct = request.headers['content-type'] ?? ''
  if (!ct.includes('application/json')) {
    void reply.status(415).send({ error: 'Content-Type must be application/json' })
    return false
  }
  return true
}

/** Returns true if the raw body exceeds the allowed size. */
export function isPayloadTooLarge(rawBody: Buffer | string | undefined): boolean {
  if (!rawBody) return false
  const size = typeof rawBody === 'string' ? Buffer.byteLength(rawBody, 'utf8') : rawBody.length
  return size > MAX_WEBHOOK_PAYLOAD_BYTES
}
