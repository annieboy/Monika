import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { createMockConnection } from '../../banking/connection.js'
import bankingStartRoute from './start.js'

interface ConnectQuery {
  userId?: string
  mock?: string
}

const bankingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ── GET /banking/start?token=... ─────────────────────────────────────────
  // Primary consent entry point: validates a one-time token and creates the
  // bank connection. Used from WhatsApp links.
  await app.register(bankingStartRoute)

  /**
   * GET /banking/connect
   *
   * Direct connection endpoint, primarily for internal/admin use.
   * When ?mock=true: skips OAuth and connects the mock provider immediately.
   * Production path (TrueLayer): generate consent URL and redirect.
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
        response: {
          200: {
            type: 'object',
            properties: {
              connectionId: { type: 'string' },
              provider: { type: 'string' },
              accountsSynced: { type: 'number' },
              transactionsImported: { type: 'number' },
              transactionsSkipped: { type: 'number' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: ConnectQuery }>,
      reply: FastifyReply,
    ) => {
      const { userId, mock } = request.query

      if (mock === 'true') {
        if (!userId) {
          return reply.status(400).send({ error: 'userId is required for mock connection' })
        }

        const { connection, syncResult } = await createMockConnection(
          request.server.prisma,
          userId,
        )

        request.log.info(
          { connectionId: connection.id, ...syncResult },
          'Mock bank connection created and synced',
        )

        return reply.status(200).send({
          connectionId: connection.id,
          provider: connection.provider,
          accountsSynced: syncResult.accountsSynced,
          transactionsImported: syncResult.transactionsImported,
          transactionsSkipped: syncResult.transactionsSkipped,
        })
      }

      return reply.status(200).send({
        message: 'Real Open Banking OAuth not yet implemented. Use ?mock=true for sandbox.',
      })
    },
  )

  /**
   * GET /banking/callback
   * OAuth callback — real provider redirects here after user grants consent.
   * Deferred to the TrueLayer integration task.
   */
  app.get('/callback', async (request, reply) => {
    request.log.info({ query: request.query }, 'Banking callback received — not yet implemented')
    return reply.status(200).send({ stub: true, message: 'Callback not yet implemented' })
  })
}

export default bankingRoutes
