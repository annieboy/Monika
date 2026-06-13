/**
 * POST /agent/chat
 *
 * HTTP interface for the message processor. Accepts userId + message, runs
 * the classify→route→store pipeline, and returns the assistant response.
 *
 * Security: this endpoint is protected by HTTP Basic Auth (same credentials
 * as the admin dashboard). It is intended for internal tooling and the e2e
 * test script only — it must NOT be exposed as a public API.
 *
 * The WhatsApp webhook is the only public ingress for user messages.
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { classifyIntent } from '../../services/agent/classifier.js'
import { routeIntent } from '../../services/agent/router.js'
import { requireAdminAuth } from '../admin/auth.js'
import { captureException } from '../../lib/monitoring.js'
import { config } from '../../config.js'

interface ChatBody {
  userId: string
  message: string
  sessionId?: string
}

const agentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Require admin credentials for every /agent/* request
  app.addHook('onRequest', async (request, reply) => {
    const ok = requireAdminAuth(request, reply)
    if (!ok) return reply
  })

  app.post<{ Body: ChatBody }>(
    '/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'message'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            message: { type: 'string', minLength: 1, maxLength: 2000 },
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId, message, sessionId = randomUUID() } = request.body
      const prisma = request.server.prisma

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      })
      if (!user) {
        return reply.status(404).send({ error: 'User not found' })
      }

      let classification: Awaited<ReturnType<typeof classifyIntent>>
      let response: string
      try {
        classification = await classifyIntent(message, config.ANTHROPIC_API_KEY)
        response = await routeIntent(
          classification.intent,
          message,
          userId,
          prisma,
          config.ANTHROPIC_API_KEY,
        )
      } catch (err) {
        captureException(err, { userId, message: message.slice(0, 100) })
        request.log.error({ err, userId }, 'Agent classification/routing failed')
        return reply.status(500).send({ error: 'Internal server error' })
      }

      const [userMsg, assistantMsg] = await Promise.all([
        prisma.conversation.create({
          data: { userId, sessionId, role: 'user', content: message },
          select: { id: true },
        }),
        prisma.conversation.create({
          data: {
            userId,
            sessionId,
            role: 'assistant',
            content: response,
            modelUsed: classification.method === 'llm' ? 'claude-haiku-4-5-20251001' : 'rules',
            toolCalls: {
              intent: classification.intent,
              confidence: classification.confidence,
              method: classification.method,
            },
          },
          select: { id: true },
        }),
      ])

      request.log.info(
        { userId, intent: classification.intent, method: classification.method },
        'Agent chat processed',
      )

      return reply.status(200).send({
        userId,
        sessionId,
        intent: classification.intent,
        confidence: classification.confidence,
        method: classification.method,
        response,
        conversationId: userMsg.id,
        responseConversationId: assistantMsg.id,
      })
    },
  )
}

export default agentRoutes
