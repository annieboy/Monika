import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { createMockConnection } from '../../banking/connection.js'

interface ConnectQuery {
  userId?: string
  mock?: string
}

const bankingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /banking/connect
   *
   * When ?mock=true is passed (sandbox/demo mode), skips the OAuth flow and
   * creates a mock bank connection directly, importing 90 days of transactions.
   *
   * Production path (TrueLayer): will validate an onboarding token, generate
   * a consent URL, and redirect the user — implemented in a later task.
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

      // Real OAuth path — placeholder until TrueLayer integration is built
      return reply.status(200).send({
        message: 'Real Open Banking OAuth flow not yet implemented. Pass ?mock=true to use the sandbox.',
      })
    },
  )

  /**
   * GET /banking/callback
   * OAuth callback endpoint — TrueLayer redirects here after user grants consent.
   * Full implementation deferred to the TrueLayer integration task.
   */
  app.get('/callback', async (request, reply) => {
    request.log.info({ query: request.query }, 'Banking callback received — not yet implemented')
    return reply.status(200).send({ stub: true, message: 'Callback not yet implemented' })
  })
}

export default bankingRoutes
