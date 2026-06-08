import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { createMockConnection, createTrueLayerConnection, resolveProvider } from '../../banking/connection.js'
import { decodeOAuthState } from '../../banking/oauth-state.js'
import { logConsentEvent } from '../../services/onboarding/audit.js'
import { successPage, failurePage } from '../../services/onboarding/pages.js'
import { config } from '../../config.js'
import bankingStartRoute from './start.js'
import disconnectRoute from './disconnect.js'
import { sendBankConnectedNotification } from '../../services/whatsapp/notify.js'

interface ConnectQuery {
  userId?: string
  mock?: string
}

interface CallbackQuery {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

const bankingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ── GET /banking/start?token=... ─────────────────────────────────────────
  await app.register(bankingStartRoute)

  // ── DELETE /banking/connections/:connectionId ─────────────────────────────
  await app.register(disconnectRoute)

  // ── GET /banking/connect ──────────────────────────────────────────────────
  /**
   * Mock-only connection shortcut for local development and the e2e script.
   * BLOCKED in production — returns 404 when NODE_ENV === 'production'.
   *
   * Security note: this endpoint bypasses OAuth entirely. It must never be
   * reachable in production. The NODE_ENV guard is the enforcement mechanism;
   * the Dockerfile also sets NODE_ENV=production.
   */
  app.get(
    '/connect',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
            mock: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: ConnectQuery }>,
      reply: FastifyReply,
    ) => {
      // Hard block in production — this endpoint must not exist outside dev
      if (process.env['NODE_ENV'] === 'production') {
        return reply.status(404).send({ error: 'Not Found' })
      }

      const { userId, mock } = request.query

      if (mock === 'true') {
        if (!userId) {
          return reply.status(400).send({ error: 'userId is required for mock connection' })
        }
        const { connection, syncResult } = await createMockConnection(
          request.server.prisma,
          userId,
        )
        request.log.info({ connectionId: connection.id, ...syncResult }, 'Mock bank connection created')
        return reply.status(200).send({
          connectionId: connection.id,
          provider: connection.provider,
          accountsSynced: syncResult.accountsSynced,
          transactionsImported: syncResult.transactionsImported,
          transactionsSkipped: syncResult.transactionsSkipped,
        })
      }

      return reply.status(200).send({
        message: 'Use /banking/start?token=<token> to initiate consent via WhatsApp link, or ?mock=true for sandbox.',
      })
    },
  )

  // ── GET /banking/callback ─────────────────────────────────────────────────
  /**
   * TrueLayer OAuth callback. TrueLayer redirects here after the user grants
   * (or denies) consent at their bank.
   *
   * Success: ?code=<auth_code>&state=<signed_state>
   * Failure: ?error=<reason>&error_description=<detail>
   */
  app.get(
    '/callback',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
            error_description: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: CallbackQuery }>,
      reply: FastifyReply,
    ) => {
      const { code, state, error, error_description } = request.query
      const prisma = request.server.prisma

      // ── User denied or provider error ─────────────────────────────────
      if (error) {
        request.log.warn({ error, error_description }, 'TrueLayer callback error')
        await logConsentEvent(prisma, 'bank_connect_failed', null, { error, description: error_description })
        return reply.status(400).type('text/html').send(failurePage('error', error_description))
      }

      if (!code || !state) {
        return reply.status(400).type('text/html').send(failurePage('error', 'Missing code or state'))
      }

      // ── Verify signed state → recover userId ──────────────────────────
      if (!config.SECRET_KEY) {
        request.log.error('SECRET_KEY not set — cannot verify OAuth state')
        return reply.status(500).type('text/html').send(failurePage('error'))
      }

      const userId = decodeOAuthState(state, config.SECRET_KEY)
      if (!userId) {
        request.log.warn({ state: state.slice(0, 20) }, 'Invalid or expired OAuth state')
        await logConsentEvent(prisma, 'bank_connect_failed', null, { reason: 'invalid_state' })
        return reply
          .status(400)
          .type('text/html')
          .send(failurePage('error', 'The consent link has expired. Please request a new one from WhatsApp.'))
      }

      // ── Exchange code → tokens, create connection, sync ───────────────
      try {
        const provider = resolveProvider()
        const consent = await provider.exchangeCode(code, state)

        const { connection, syncResult } = await createTrueLayerConnection(
          prisma,
          userId,
          consent,
          provider,
        )

        await logConsentEvent(prisma, 'bank_connect_completed', userId, {
          connectionId: connection.id,
          provider: connection.provider,
          accountsSynced: syncResult.accountsSynced,
          transactionsImported: syncResult.transactionsImported,
        })

        request.log.info(
          { userId, connectionId: connection.id, ...syncResult },
          'TrueLayer bank connection completed',
        )

        sendBankConnectedNotification(prisma, userId, syncResult).catch((err: unknown) => {
          request.log.error({ err, userId }, 'Failed to send bank-connected WhatsApp notification')
        })

        return reply
          .status(200)
          .type('text/html')
          .send(successPage(syncResult.transactionsImported, syncResult.accountsSynced))
      } catch (err) {
        await logConsentEvent(prisma, 'bank_connect_failed', userId, {
          error: err instanceof Error ? err.message : String(err),
        })
        request.log.error({ err, userId }, 'TrueLayer connection failed')
        return reply.status(500).type('text/html').send(failurePage('error'))
      }
    },
  )
}

export default bankingRoutes
