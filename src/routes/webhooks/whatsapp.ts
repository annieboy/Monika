/**
 * WhatsApp Webhook — PLACEHOLDER
 *
 * Two endpoints required by Meta's WhatsApp Cloud API:
 *
 *   GET  /webhooks/whatsapp — webhook verification (one-time setup)
 *   POST /webhooks/whatsapp — inbound messages and status updates
 *
 * Implementation status: STUB — returns correct HTTP shapes but does
 * no processing. HMAC signature verification, message parsing, and
 * agent dispatch will be added in a later task.
 *
 * See IMPLEMENTATION_PLAN.md § Task 5.1 for the full spec.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { config } from '../../config.js'

interface WhatsAppVerifyQuery {
  'hub.mode': string
  'hub.verify_token': string
  'hub.challenge': string
}

const whatsappRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /webhooks/whatsapp
   *
   * Meta sends a GET request to verify the webhook endpoint when you first
   * register it in the Meta Developer Console. Must respond with hub.challenge
   * within 5 seconds or Meta considers the verification failed.
   *
   * Security: validates hub.verify_token against WHATSAPP_VERIFY_TOKEN env var.
   */
  app.get<{ Querystring: WhatsAppVerifyQuery }>('/whatsapp', async (request, reply) => {
    const { 'hub.mode': mode, 'hub.verify_token': verifyToken, 'hub.challenge': challenge } =
      request.query

    if (mode === 'subscribe' && verifyToken === config.WHATSAPP_VERIFY_TOKEN) {
      request.log.info('WhatsApp webhook verified')
      return reply.status(200).send(challenge)
    }

    request.log.warn({ mode, verifyTokenMatch: verifyToken === config.WHATSAPP_VERIFY_TOKEN },
      'WhatsApp webhook verification failed')
    return reply.status(403).send({ error: 'Forbidden' })
  })

  /**
   * POST /webhooks/whatsapp
   *
   * Receives inbound messages, message status updates, and other events.
   *
   * Production implementation will:
   * 1. Verify X-Hub-Signature-256 HMAC (CRITICAL security control)
   * 2. Deduplicate by wa_message_id
   * 3. Enqueue to SQS for async processing
   * 4. Return 200 immediately (Meta retries if it doesn't get 200 within 20s)
   *
   * Stub: acknowledges receipt, logs the payload shape, returns 200.
   */
  app.post('/whatsapp', async (request: FastifyRequest, reply) => {
    // TODO (Task 5.1): Verify X-Hub-Signature-256 before reading body
    // TODO (Task 5.1): Deduplicate by wa_message_id
    // TODO (Task 5.3): Enqueue to inbound message queue

    request.log.info(
      { bodyType: typeof request.body },
      '[STUB] WhatsApp webhook received — not yet processing',
    )

    // Meta requires a 200 response. Returning anything else causes retries.
    return reply.status(200).send()
  })
}

export default whatsappRoutes
