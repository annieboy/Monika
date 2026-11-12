/**
 * Conversational bank disconnect.
 *
 * Revokes all of a user's active bank connections — best-effort TrueLayer
 * revocation, then marks the connection revoked and its accounts inactive so
 * no further syncs run. The user can reconnect at any time (which creates a
 * fresh connection). Mirrors the DELETE /banking/connections route so the
 * chat command and the API behave identically.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { TrueLayerProvider } from '../../banking/providers/truelayer.js'
import { logConsentEvent } from '../onboarding/audit.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export async function disconnectAllBanks(
  prisma: PrismaClient,
  userId: string,
): Promise<{ disconnected: number }> {
  const connections = await prisma.bankConnection.findMany({
    where: { userId, consentStatus: 'active' },
    select: { id: true, provider: true, accessTokenEnc: true },
  })

  let disconnected = 0
  for (const conn of connections) {
    // Best-effort provider revocation — still mark revoked if the API fails.
    if (conn.provider === 'truelayer' && config.TRUELAYER_CLIENT_ID) {
      try {
        const accessToken = decrypt(Buffer.from(conn.accessTokenEnc), config.ENCRYPTION_KEY).toString('utf-8')
        const provider = new TrueLayerProvider(
          config.TRUELAYER_CLIENT_ID,
          config.TRUELAYER_CLIENT_SECRET,
          config.TRUELAYER_REDIRECT_URI,
          config.TRUELAYER_ENVIRONMENT,
        )
        await provider.revokeConsent(accessToken)
      } catch (err) {
        logger.warn({ err, connectionId: conn.id }, 'TrueLayer revocation failed — marking revoked anyway')
      }
    }

    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: { consentStatus: 'revoked' },
    })
    await prisma.account.updateMany({
      where: { connectionId: conn.id },
      data: { isActive: false },
    })
    await logConsentEvent(prisma, 'bank_disconnected', userId, { connectionId: conn.id, via: 'chat' })
    disconnected++
  }

  return { disconnected }
}
