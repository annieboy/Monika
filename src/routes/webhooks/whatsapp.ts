/**
 * POST /webhooks/whatsapp — Meta WhatsApp Cloud API webhook
 * GET  /webhooks/whatsapp — Meta webhook verification handshake
 *
 * Inbound flow:
 *   1. HMAC-SHA256 signature verification (mandatory, rejects without it)
 *   2. Parse text messages + delivery status updates from the same payload
 *   3. Text messages → processInboundMessage → classify + store
 *   4. Send AI reply back to user via Meta Cloud API
 *   5. Store outbound wamid on the assistant Conversation row
 *   6. Status updates → processStatusUpdate → update wa_status on conversation
 *
 * Security: raw body is captured as Buffer before JSON parsing so the HMAC
 * is computed over exactly what Meta signed.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../../config.js'
import { verifyHmacSignature, hashPhoneNumber } from '../../lib/crypto.js'
import { parseTextMessage, parseStatusUpdates } from '../../services/whatsapp/parser.js'
import { processInboundMessage } from '../../services/whatsapp/webhook.js'
import { sendWhatsAppMessage, SendError } from '../../services/whatsapp/sender.js'
import { processStatusUpdate } from '../../services/whatsapp/status.js'
import { checkUserRateLimit } from '../../lib/userRateLimit.js'
import { captureException } from '../../lib/monitoring.js'
import type { WhatsAppWebhookPayload } from '../../types/whatsapp.js'

interface VerifyQuery {
  'hub.mode': string
  'hub.verify_token': string
  'hub.challenge': string
}

const whatsappRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /webhooks/whatsapp
   * Meta calls this once during webhook setup to verify endpoint ownership.
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
   * Receives inbound messages and delivery status updates from Meta.
   * Must return 200 quickly — Meta retries if we take >20 s or return non-2xx.
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
      config: {
        // Meta delivers at most a few messages per second per WABA.
        // 300/min allows bursts while preventing DoS from non-Meta senders.
        rateLimit: { max: 300, timeWindow: '1 minute' },
      },
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

      // ── 1b. Replay protection — reject requests older than 5 minutes ───────
      // Meta sends X-Hub-Timestamp (Unix seconds). Requests outside the window
      // are either replayed captures or severely delayed deliveries.
      const tsHeader = request.headers['x-hub-timestamp']
      if (tsHeader) {
        const tsSeconds = Number(tsHeader)
        const ageMs = Date.now() - tsSeconds * 1000
        if (Number.isFinite(tsSeconds) && (ageMs < -30_000 || ageMs > 5 * 60_000)) {
          request.log.warn({ ageMs }, 'WhatsApp webhook timestamp outside acceptable window')
          return reply.status(403).send({ error: 'Forbidden' })
        }
      }

      // ── 2. Parse JSON body ─────────────────────────────────────────────────
      let payload: WhatsAppWebhookPayload
      try {
        payload = JSON.parse(request.body.toString('utf-8')) as WhatsAppWebhookPayload
      } catch {
        return reply.status(400).send({ error: 'Invalid JSON' })
      }

      const prisma = request.server.prisma

      // ── 3. Handle delivery status updates (fire-and-forget errors) ─────────
      const statusUpdates = parseStatusUpdates(payload)
      for (const update of statusUpdates) {
        processStatusUpdate(prisma, update).catch((err: unknown) => {
          request.log.error({ err, waMessageId: update.waMessageId }, 'Failed to store status update')
        })
      }

      // ── 4. Extract the first text message ─────────────────────────────────
      const parsed = parseTextMessage(payload)
      if (!parsed) {
        return reply.status(200).send({ status: 'ok' })
      }

      const wabaId =
        payload.entry[0]?.changes[0]?.value.metadata.phone_number_id ?? ''

      // ── 4b. Per-user rate limit ────────────────────────────────────────────
      // All Meta traffic shares the same source IPs, so IP-level limiting is
      // useless. Key by phone hash to cap individual users at 10 msg/min.
      if (config.SECRET_KEY) {
        const phoneHash = hashPhoneNumber(parsed.from, config.SECRET_KEY)
        const rateResult = await checkUserRateLimit(phoneHash, config.REDIS_URL)
        if (!rateResult.allowed) {
          request.log.warn({ retryAfterSecs: rateResult.retryAfterSecs }, 'Per-user WhatsApp rate limit exceeded')
          // Return 200 to Meta — a 429 would trigger retries that make the problem worse
          return reply.status(200).send({ status: 'ok' })
        }
      }

      // ── 5. Deduplicate + classify + store ──────────────────────────────────
      const result = await processInboundMessage(
        prisma,
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
        { userId: result.userId, isNewUser: result.isNewUser, intent: result.intent },
        'WhatsApp message processed',
      )

      // ── 6. Send AI reply back via WhatsApp ─────────────────────────────────
      const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
      const accessToken = config.WHATSAPP_ACCESS_TOKEN

      if (phoneNumberId && accessToken) {
        sendWhatsAppMessage(parsed.from, result.response, phoneNumberId, accessToken)
          .then(({ waMessageId: outboundWamid }) => {
            // Store outbound wamid on the assistant row so status callbacks resolve
            return prisma.conversation.update({
              where: { id: result.responseConversationId },
              data: { waMessageId: outboundWamid, waStatus: 'sent' },
            })
          })
          .catch((err: unknown) => {
            captureException(err, { userId: result.userId })
            if (err instanceof SendError) {
              request.log.error(
                { err, userId: result.userId, statusCode: err.statusCode },
                'Failed to send WhatsApp reply',
              )
            } else {
              request.log.error({ err, userId: result.userId }, 'Unexpected error sending WhatsApp reply')
            }
          })
      } else {
        request.log.warn(
          { userId: result.userId },
          'WhatsApp credentials not configured — reply not sent',
        )
      }

      return reply.status(200).send({ status: 'ok' })
    },
  )
}

export default whatsappRoutes
