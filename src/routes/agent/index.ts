/**
 * POST /agent/chat
 *
 * HTTP interface for the message processor. Takes a userId + message,
 * runs the same classify→route→store pipeline as the WhatsApp webhook,
 * and returns the assistant response.
 *
 * In production this endpoint would sit behind authentication middleware.
 * For the MVP it accepts any userId so internal tools and the e2e script
 * can call it directly.
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { classifyIntent } from '../../services/agent/classifier.js'
import { routeIntent } from '../../services/agent/router.js'
import { config } from '../../config.js'

interface ChatBody {
  userId: string
  message: string
  sessionId?: string
}

const agentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
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

      const classification = await classifyIntent(message, config.ANTHROPIC_API_KEY)
      const response = await routeIntent(
        classification.intent,
        message,
        userId,
        prisma,
        config.ANTHROPIC_API_KEY,
      )

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
