/**
 * AI Agent Routes — PLACEHOLDER
 *
 * The agent service processes natural language queries against the user's
 * financial data. Compatible with both Anthropic (Claude) and OpenAI APIs
 * via a common tool-calling interface.
 *
 * Implementation status: STUB — route exists, returns correct shape.
 *
 * See IMPLEMENTATION_PLAN.md § Task 7.1 for the full spec.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'

interface ChatBody {
  message: string
  sessionId?: string
}

const agentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /agent/chat
   *
   * Production: authenticates the user, loads conversation history, calls
   * the Claude/OpenAI agent with tool definitions, executes tool calls
   * against the database, returns the agent's response.
   *
   * Stub: echoes the message back with a placeholder response.
   */
  app.post<{ Body: ChatBody }>('/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 2000 },
          sessionId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    // TODO (Task 7.1): Authenticate user from session/token
    // TODO (Task 7.1): Load conversation history from database
    // TODO (Task 7.1): Call AnthropicClient.createMessage with tool definitions
    // TODO (Task 7.2): Execute tool calls (spending queries, subscriptions, etc.)
    // TODO (Task 7.4): Save exchange to conversations table

    const { message, sessionId } = request.body

    request.log.info(
      { messageLength: message.length, sessionId },
      '[STUB] /agent/chat — AI agent not yet implemented',
    )

    return reply.status(200).send({
      stub: true,
      message: 'AI agent not yet implemented',
      echo: message,
      nextTask: 'Task 7.1 — Anthropic client and base agent',
    })
  })
}

export default agentRoutes
