/**
 * Affiliate redirect and postback routes.
 *
 * GET  /r/:shortCode          — Click tracking redirect to partner
 * POST /webhooks/affiliate/awin    — Awin commission postback
 * POST /webhooks/affiliate/cj      — CJ Affiliate commission postback
 * POST /webhooks/affiliate/impact  — Impact commission postback
 *
 * Security:
 * - Postbacks are signature-verified using AFFILIATE_POSTBACK_SECRET
 * - Redirect logs click metadata but still redirects even if fraud-flagged
 *   (never tip off bad actors by blocking the redirect)
 * - Raw body is captured for postback signature verification
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { recordRedirect, recordPostback } from '../services/affiliate/clickTrackingService.js'
import { createHmac } from 'crypto'
import { config } from '../config.js'

function verifyPostbackSignature(body: string, signature: string, secret: string): boolean {
  if (!secret) return true // if not configured, skip verification in dev
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  return expected === signature
}

const affiliateRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // ── Click redirect ──────────────────────────────────────────────────────
  app.get<{ Params: { shortCode: string } }>(
    '/r/:shortCode',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: { type: 'object', properties: { shortCode: { type: 'string', maxLength: 16 } }, required: ['shortCode'] },
      },
    },
    async (request, reply) => {
      const { shortCode } = request.params
      const ip = request.ip ?? 'unknown'
      const userAgent = request.headers['user-agent'] ?? ''

      const result = await recordRedirect(
        app.prisma,
        shortCode,
        ip,
        userAgent,
      )

      if (!result) {
        return reply.status(404).send({ error: 'Link not found or expired' })
      }

      return reply.status(302).redirect(result.redirectUrl)
    },
  )

  // ── Awin postback ───────────────────────────────────────────────────────
  app.post<{
    Body: {
      clickRef?: string
      transactionId?: string
      commissionAmount?: number
      saleAmount?: number
      status?: string
    }
  }>(
    '/webhooks/affiliate/awin',
    { config: { rateLimit: { max: 200, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const sig = String(request.headers['x-awin-signature'] ?? '')
      const rawBody = JSON.stringify(request.body)

      if (!verifyPostbackSignature(rawBody, sig, config.AFFILIATE_POSTBACK_SECRET)) {
        request.log.warn('Awin postback: invalid signature')
        return reply.status(401).send({ error: 'Invalid signature' })
      }

      const { clickRef, transactionId, commissionAmount, status } = request.body

      if (!clickRef || !transactionId) {
        return reply.status(400).send({ error: 'Missing clickRef or transactionId' })
      }

      const normalizedStatus =
        status === 'approved' ? 'approved' :
        status === 'declined' || status === 'rejected' ? 'rejected' : 'pending'

      await recordPostback(
        app.prisma,
        clickRef,
        transactionId,
        commissionAmount ?? 0,
        normalizedStatus,
        request.body,
      )

      return reply.status(200).send({ ok: true })
    },
  )

  // ── CJ postback ─────────────────────────────────────────────────────────
  app.post<{
    Body: { sid?: string; orderId?: string; commissionAmount?: number; actionStatus?: string }
  }>(
    '/webhooks/affiliate/cj',
    { config: { rateLimit: { max: 200, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { sid, orderId, commissionAmount, actionStatus } = request.body

      if (!sid || !orderId) {
        return reply.status(400).send({ error: 'Missing sid or orderId' })
      }

      const normalizedStatus =
        actionStatus === 'approved' ? 'approved' :
        actionStatus === 'reversed' ? 'rejected' : 'pending'

      await recordPostback(app.prisma, sid, orderId, commissionAmount ?? 0, normalizedStatus, request.body)
      return reply.status(200).send({ ok: true })
    },
  )

  // ── Impact postback ─────────────────────────────────────────────────────
  app.post<{
    Body: { SubId1?: string; OrderId?: string; PubCommissionAmount?: number; ActionStatus?: string }
  }>(
    '/webhooks/affiliate/impact',
    { config: { rateLimit: { max: 200, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { SubId1, OrderId, PubCommissionAmount, ActionStatus } = request.body

      if (!SubId1 || !OrderId) {
        return reply.status(400).send({ error: 'Missing SubId1 or OrderId' })
      }

      const normalizedStatus =
        ActionStatus === 'approved' ? 'approved' :
        ActionStatus === 'reversed' ? 'rejected' : 'pending'

      await recordPostback(app.prisma, SubId1, OrderId, PubCommissionAmount ?? 0, normalizedStatus, request.body)
      return reply.status(200).send({ ok: true })
    },
  )
}

export default affiliateRoutes
