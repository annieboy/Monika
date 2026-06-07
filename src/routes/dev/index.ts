/**
 * Development-only routes — NOT registered in production.
 *
 * These endpoints bypass authentication and HMAC verification so the
 * e2e test script and local tooling can drive the full user flow without
 * a real WhatsApp account or TrueLayer browser session.
 *
 * Registered only when NODE_ENV !== 'production' (enforced in app.ts).
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { processInboundMessage } from '../../services/whatsapp/webhook.js'

interface SimulateBody {
  phone: string    // raw phone — hashed server-side, never stored
  message: string
  wabaId?: string
}

const devRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /dev/simulate
   *
   * Simulates an inbound WhatsApp message from a phone number.
   * Runs the full classify → route → store pipeline and returns the
   * assistant response alongside user and intent metadata.
   */
  app.post<{ Body: SimulateBody }>(
    '/simulate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'message'],
          properties: {
            phone: { type: 'string', minLength: 5 },
            message: { type: 'string', minLength: 1, maxLength: 2000 },
            wabaId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { phone, message, wabaId = 'dev-waba' } = request.body
      const waMessageId = `dev-${randomUUID()}`

      const result = await processInboundMessage(
        request.server.prisma,
        waMessageId,
        phone,
        message,
        wabaId,
      )

      if (!result) {
        return reply.status(409).send({ error: 'Duplicate message ID — should not happen in dev' })
      }

      return reply.status(200).send(result)
    },
  )

  /**
   * GET /dev/status
   *
   * Returns a summary of data in the database — useful for verifying
   * state mid-test without opening the admin dashboard.
   */
  app.get('/status', async (request, reply) => {
    const prisma = request.server.prisma
    const [users, connections, accounts, transactions, conversations, auditEvents] =
      await Promise.all([
        prisma.user.count(),
        prisma.bankConnection.count(),
        prisma.account.count(),
        prisma.transaction.count(),
        prisma.conversation.count(),
        prisma.auditLog.count(),
      ])

    return reply.status(200).send({
      users,
      bankConnections: connections,
      accounts,
      transactions,
      conversations,
      auditEvents,
    })
  })
}

export default devRoutes
