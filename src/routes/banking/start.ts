import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { validateAndConsumeToken } from '../../services/onboarding/token.js'
import { logConsentEvent } from '../../services/onboarding/audit.js'
import { successPage, failurePage } from '../../services/onboarding/pages.js'
import { createMockConnection } from '../../banking/connection.js'

interface StartQuery {
  token?: string
}

/**
 * GET /banking/start?token=<64-char-hex>
 *
 * The in-browser bank connection consent page. Users arrive here by tapping
 * the personalised link Monika sends them in WhatsApp.
 *
 * Flow:
 *   1. Validate the one-time token (checks expiry + single-use)
 *   2. Create the mock bank connection and import 90 days of transactions
 *   3. Return a success or failure HTML page
 *
 * When a real provider is integrated, step 2 becomes an OAuth redirect.
 * The token validation and audit logging remain unchanged.
 */
const bankingStartRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get(
    '/start',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { token: { type: 'string' } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: StartQuery }>,
      reply: FastifyReply,
    ) => {
      const { token } = request.query
      const prisma = request.server.prisma

      if (!token) {
        return reply
          .status(400)
          .type('text/html')
          .send(failurePage('not_found'))
      }

      // ── 1. Validate token ────────────────────────────────────────────────
      const validation = await validateAndConsumeToken(prisma, token)

      if (!validation.ok) {
        const auditEvent =
          validation.reason === 'expired'
            ? 'bank_connect_token_expired'
            : validation.reason === 'already_used'
              ? 'bank_connect_token_already_used'
              : 'bank_connect_token_not_found'

        await logConsentEvent(prisma, auditEvent, null, { token: token.slice(0, 8) + '…' })

        request.log.warn({ reason: validation.reason }, 'Bank connect token validation failed')

        const pageReason =
          validation.reason === 'expired'
            ? 'expired'
            : validation.reason === 'already_used'
              ? 'already_used'
              : 'not_found'

        return reply.status(400).type('text/html').send(failurePage(pageReason))
      }

      const { userId } = validation

      await logConsentEvent(prisma, 'bank_connect_token_opened', userId, {
        token: token.slice(0, 8) + '…',
      })

      // ── 2. Create bank connection + sync transactions ─────────────────────
      try {
        const { connection, syncResult } = await createMockConnection(prisma, userId)

        await logConsentEvent(prisma, 'bank_connect_completed', userId, {
          connectionId: connection.id,
          provider: connection.provider,
          accountsSynced: syncResult.accountsSynced,
          transactionsImported: syncResult.transactionsImported,
        })

        request.log.info(
          { userId, connectionId: connection.id, ...syncResult },
          'Bank connection completed via consent flow',
        )

        return reply
          .status(200)
          .type('text/html')
          .send(successPage(syncResult.transactionsImported, syncResult.accountsSynced))
      } catch (err) {
        await logConsentEvent(prisma, 'bank_connect_failed', userId, {
          error: err instanceof Error ? err.message : String(err),
        })

        request.log.error({ err, userId }, 'Bank connection failed during consent flow')

        return reply.status(500).type('text/html').send(failurePage('error'))
      }
    },
  )
}

export default bankingStartRoute
