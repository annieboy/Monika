/**
 * DELETE /banking/connections/:connectionId
 *
 * Revokes a bank connection — calls TrueLayer's revocation endpoint,
 * marks the connection as revoked in the DB, and logs the event.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { TrueLayerProvider } from '../../banking/providers/truelayer.js'
import { decrypt } from '../../lib/crypto.js'
import { logConsentEvent } from '../../services/onboarding/audit.js'
import { config } from '../../config.js'

interface DisconnectParams {
  connectionId: string
}

interface DisconnectBody {
  userId: string
}

const disconnectRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.delete<{ Params: DisconnectParams; Body: DisconnectBody }>(
    '/connections/:connectionId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['connectionId'],
          properties: { connectionId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: DisconnectParams; Body: DisconnectBody }>,
      reply: FastifyReply,
    ) => {
      const { connectionId } = request.params
      const { userId } = request.body
      const prisma = request.server.prisma

      const connection = await prisma.bankConnection.findFirst({
        where: { id: connectionId, userId },
        select: { id: true, provider: true, accessTokenEnc: true, consentStatus: true },
      })

      if (!connection) {
        return reply.status(404).send({ error: 'Connection not found' })
      }

      if (connection.consentStatus === 'revoked') {
        return reply.status(409).send({ error: 'Connection already revoked' })
      }

      // Attempt TrueLayer revocation (best-effort — still mark revoked if API fails)
      if (connection.provider === 'truelayer' && config.TRUELAYER_CLIENT_ID) {
        try {
          const accessToken = decrypt(
            Buffer.from(connection.accessTokenEnc),
            config.ENCRYPTION_KEY,
          ).toString('utf-8')

          const provider = new TrueLayerProvider(
            config.TRUELAYER_CLIENT_ID,
            config.TRUELAYER_CLIENT_SECRET,
            config.TRUELAYER_REDIRECT_URI,
            config.TRUELAYER_ENVIRONMENT,
          )
          await provider.revokeConsent(accessToken)
        } catch (err) {
          request.log.warn({ err, connectionId }, 'TrueLayer revocation API call failed — marking revoked anyway')
        }
      }

      await prisma.bankConnection.update({
        where: { id: connectionId },
        data: { consentStatus: 'revoked' },
      })

      await logConsentEvent(prisma, 'bank_disconnected', userId, { connectionId })

      return reply.status(204).send()
    },
  )
}

export default disconnectRoute
