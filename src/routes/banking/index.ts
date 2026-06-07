/**
 * Open Banking Routes — PLACEHOLDER
 *
 * Handles the TrueLayer OAuth consent flow:
 *
 *   GET /banking/connect  — generates a TrueLayer consent URL and returns it
 *   GET /banking/callback — OAuth callback: exchanges code for tokens, stores them
 *
 * Implementation status: STUB — routes exist and return correct HTTP shapes
 * but perform no real Open Banking operations.
 *
 * See IMPLEMENTATION_PLAN.md § Task 6.2 for the full spec.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'

const bankingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /banking/connect
   *
   * Production: validates the user's onboarding token, generates a TrueLayer
   * hosted consent URL, redirects the user to it.
   *
   * Stub: returns a placeholder response.
   */
  app.get('/connect', async (request, reply) => {
    // TODO (Task 6.2): Validate onboarding token from query params
    // TODO (Task 6.2): Call TrueLayer to generate consent URL
    // TODO (Task 6.2): Redirect to TrueLayer consent URL

    request.log.info('[STUB] /banking/connect — Open Banking not yet implemented')

    return reply.status(200).send({
      stub: true,
      message: 'Open Banking integration not yet implemented',
      nextTask: 'Task 6.2 — BankingService consent management',
    })
  })

  /**
   * GET /banking/callback
   *
   * Production: TrueLayer redirects here after the user grants consent.
   * Exchanges the auth code for tokens, fetches initial account list,
   * stores encrypted tokens, triggers initial transaction sync.
   *
   * Stub: logs received params and returns 200.
   */
  app.get('/callback', async (request, reply) => {
    // TODO (Task 6.2): Verify state parameter (CSRF protection)
    // TODO (Task 6.2): Exchange code for tokens via TrueLayer
    // TODO (Task 6.2): Store encrypted tokens in bank_connections table
    // TODO (Task 6.3): Enqueue initial transaction sync

    request.log.info(
      { query: request.query },
      '[STUB] /banking/callback — Open Banking not yet implemented',
    )

    return reply.status(200).send({
      stub: true,
      message: 'Open Banking callback not yet implemented',
    })
  })
}

export default bankingRoutes
