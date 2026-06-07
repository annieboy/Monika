import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../../config.js'
import { verifyHmacSignature } from '../../lib/crypto.js'
import { parseTextMessage } from '../../services/whatsapp/parser.js'
import { processInboundMessage } from '../../services/whatsapp/webhook.js'
import type { WhatsAppWebhookPayload } from '../../types/whatsapp.js'

interface VerifyQuery {
  'hub.mode': string
  'hub.verify_token': string
  'hub.challenge': string
}

const whatsappRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /webhooks/whatsapp
   * Meta calls this during webhook setup to verify we own the endpoint.
   */
  app.get(
    '/whatsapp',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            'hub.mode': { type: 'string' },
            'hub.verify_token': { type: 'string' },
            'hub.challenge': { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: VerifyQuery }>,
      reply: FastifyReply,
    ) => {
      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } =
        request.query

      if (mode !== 'subscribe') {
        return reply.status(400).send({ error: 'Invalid hub.mode' })
      }

      if (!config.WHATSAPP_VERIFY_TOKEN || token !== config.WHATSAPP_VERIFY_TOKEN) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      return reply.status(200).send(challenge)
    },
  )

  /**
   * POST /webhooks/whatsapp
   * Receives inbound messages and status updates from Meta.
   *
   * Security: HMAC-SHA256 signature verification is mandatory and happens before
   * JSON parsing. We capture the raw body as a Buffer to compute the HMAC.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body)
    },
  )

  app.post(
    '/whatsapp',
    {
      schema: {
        response: {
          200: { type: 'object', properties: { status: { type: 'string' } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: Buffer }>,
      reply: FastifyReply,
    ) => {
      // ── 1. Signature verification ──────────────────────────────────────────
      const signatureHeader = request.headers['x-hub-signature-256'] ?? ''
      const appSecret = config.WHATSAPP_APP_SECRET

      if (
        !appSecret ||
        !signatureHeader ||
        !verifyHmacSignature(request.body, String(signatureHeader), appSecret)
      ) {
        request.log.warn({ path: request.url }, 'WhatsApp webhook signature verification failed')
        return reply.status(403).send({ error: 'Forbidden' })
      }

      // ── 2. Parse JSON body ─────────────────────────────────────────────────
      let payload: WhatsAppWebhookPayload
      try {
        payload = JSON.parse(request.body.toString('utf-8')) as WhatsAppWebhookPayload
      } catch {
        return reply.status(400).send({ error: 'Invalid JSON' })
      }

      // ── 3. Extract text message (ignore status updates, media, etc.) ───────
      const parsed = parseTextMessage(payload)
      if (!parsed) {
        return reply.status(200).send({ status: 'ok' })
      }

      const wabaId =
        payload.entry[0]?.changes[0]?.value.metadata.phone_number_id ?? ''

      // ── 4. Store message ───────────────────────────────────────────────────
      const result = await processInboundMessage(
        request.server.prisma,
        parsed.waMessageId,
        parsed.from,
        parsed.text,
        wabaId,
      )

      if (!result) {
        request.log.debug({ waMessageId: parsed.waMessageId }, 'Duplicate WhatsApp message ignored')
        return reply.status(200).send({ status: 'ok' })
      }

      request.log.info(
        { userId: result.userId, isNewUser: result.isNewUser, waMessageId: parsed.waMessageId },
        'WhatsApp message stored',
      )

      return reply.status(200).send({ status: 'ok' })
    },
  )
}

export default whatsappRoutes
