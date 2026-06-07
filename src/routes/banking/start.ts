import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { validateAndConsumeToken } from '../../services/onboarding/token.js'
import { logConsentEvent } from '../../services/onboarding/audit.js'
import { successPage, failurePage } from '../../services/onboarding/pages.js'
import { createMockConnection, resolveProvider } from '../../banking/connection.js'
import { encodeOAuthState } from '../../banking/oauth-state.js'
import { config } from '../../config.js'

interface StartQuery {
  token?: string
}

/**
 * GET /banking/start?token=<64-char-hex>
 *
 * Entry point sent to users via WhatsApp. Validates the one-time token and
 * then branches based on whether TrueLayer is configured:
 *
 *   TrueLayer configured → redirect to TrueLayer auth (userId in signed state)
 *   No TrueLayer creds   → create mock connection directly (local dev / tests)
 *
 * The token is always consumed before the redirect so it cannot be reused
 * even if the user abandons the OAuth flow.
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
        return reply.status(400).type('text/html').send(failurePage('not_found'))
      }

      // ── 1. Validate one-time token ────────────────────────────────────────
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

      const provider = resolveProvider()
      const isTrueLayer = provider.providerName !== 'mock'

      // ── 2a. TrueLayer: redirect to bank auth ─────────────────────────────
      if (isTrueLayer) {
        if (!config.SECRET_KEY) {
          request.log.error('SECRET_KEY must be set for TrueLayer OAuth state signing')
          return reply.status(500).type('text/html').send(failurePage('error'))
        }

        const state = encodeOAuthState(userId, config.SECRET_KEY)
        const { authUrl } = await provider.initiateConsent(userId, config.TRUELAYER_REDIRECT_URI)

        // Replace the random state TrueLayer generated with our signed one
        const url = new URL(authUrl)
        url.searchParams.set('state', state)

        request.log.info({ userId }, 'Redirecting to TrueLayer consent')
        return reply.redirect(url.toString(), 302)
      }

      // ── 2b. Mock: create connection directly ──────────────────────────────
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
          'Mock bank connection completed via consent flow',
        )

        return reply
          .status(200)
          .type('text/html')
          .send(successPage(syncResult.transactionsImported, syncResult.accountsSynced))
      } catch (err) {
        await logConsentEvent(prisma, 'bank_connect_failed', userId, {
          error: err instanceof Error ? err.message : String(err),
        })
        request.log.error({ err, userId }, 'Mock bank connection failed')
        return reply.status(500).type('text/html').send(failurePage('error'))
      }
    },
  )
}

export default bankingStartRoute
