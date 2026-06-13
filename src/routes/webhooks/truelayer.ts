/**
 * TrueLayer Data API webhook handler.
 *
 * TrueLayer POSTs signed events when a user's bank data changes — new
 * transactions, consent revocation, token expiry, etc.
 *
 * Security: every request carries a `tl-signature` header containing an
 * HMAC-SHA256 signature over `method + path + body` using the shared webhook
 * secret configured in the TrueLayer console. We verify before processing.
 *
 * Supported event types:
 *   - `transaction_created`  → run detectOpportunities for the user
 *   - `consent_revoked`      → mark BankConnection as revoked
 *   - `token_expired`        → mark BankConnection as expired
 *
 * Unknown event types are acknowledged (200) and logged at debug level so
 * future TrueLayer event types don't cause alert noise.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { createHmac, timingSafeEqual } from 'crypto'
import { config } from '../../config.js'
import { logger } from '../../logger.js'
import { detectOpportunities } from '../../services/opportunity/opportunityDetector.js'

// ── Signature verification ──────────────────────────────────────────────────

function verifyTrueLayerSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signature) return false
  try {
    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    const receivedBuf = Buffer.from(signature.replace(/^sha256=/, ''), 'hex')
    if (expectedBuf.length !== receivedBuf.length) return false
    return timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}

// ── Event payload shapes ────────────────────────────────────────────────────

interface TrueLayerEvent {
  type: string
  event_id: string
  timestamp: string
  payload: Record<string, unknown>
}

// ── Route plugin ────────────────────────────────────────────────────────────

const truelayerWebhookRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: TrueLayerEvent }>(
    '/truelayer',
    {
      config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const rawBody = JSON.stringify(request.body)
      const signature = request.headers['tl-signature'] as string | undefined

      // Only verify when a secret is configured (skip in dev/test with no secret)
      if (config.TRUELAYER_WEBHOOK_SECRET) {
        const valid = verifyTrueLayerSignature(rawBody, signature, config.TRUELAYER_WEBHOOK_SECRET)
        if (!valid) {
          logger.warn({ eventId: request.body?.event_id }, 'TrueLayer webhook signature invalid')
          return reply.status(401).send({ error: 'Invalid signature' })
        }
      }

      const event = request.body
      logger.debug({ type: event.type, eventId: event.event_id }, 'TrueLayer webhook received')

      try {
        await handleEvent(app, event)
      } catch (err) {
        logger.error({ err, type: event.type, eventId: event.event_id }, 'TrueLayer webhook handler error')
        // Return 200 so TrueLayer doesn't retry — we logged the failure
      }

      return reply.status(200).send({ ok: true })
    },
  )
}

async function handleEvent(app: FastifyInstance, event: TrueLayerEvent): Promise<void> {
  const prisma = app.prisma

  switch (event.type) {
    case 'transaction_created': {
      const userId = event.payload['user_id'] as string | undefined
      if (!userId) {
        logger.warn({ eventId: event.event_id }, 'transaction_created missing user_id')
        return
      }
      const count = await detectOpportunities(prisma, userId)
      logger.info({ userId, opportunitiesDetected: count }, 'TrueLayer transaction_created: opportunities detected')
      break
    }

    case 'consent_revoked': {
      const consentId = event.payload['consent_id'] as string | undefined
      if (!consentId) return
      await prisma.bankConnection.updateMany({
        where: { providerConsentId: consentId },
        data: { consentStatus: 'revoked' },
      })
      logger.info({ consentId }, 'TrueLayer consent_revoked: connection marked revoked')
      break
    }

    case 'token_expired': {
      const consentId = event.payload['consent_id'] as string | undefined
      if (!consentId) return
      await prisma.bankConnection.updateMany({
        where: { providerConsentId: consentId },
        data: { consentStatus: 'expired' },
      })
      logger.info({ consentId }, 'TrueLayer token_expired: connection marked expired')
      break
    }

    default:
      logger.debug({ type: event.type, eventId: event.event_id }, 'TrueLayer webhook: unhandled event type')
  }
}

export default truelayerWebhookRoutes
