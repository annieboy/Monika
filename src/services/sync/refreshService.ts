/**
 * On-demand data refresh for a single user.
 *
 * Monika normally syncs every few hours; this lets a user force an immediate
 * pull from their bank ("refresh my account") so a very recent withdrawal or
 * payment shows up right away. Mirrors the scheduled sync, scoped to one user's
 * active connections.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { runFullSync } from '../../banking/sync.js'
import { TrueLayerProvider } from '../../banking/providers/truelayer.js'
import type { ProviderConsent } from '../../banking/types.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface RefreshResult {
  connections: number
  transactionsImported: number
  errors: number
}

export async function refreshUserData(prisma: PrismaClient, userId: string): Promise<RefreshResult> {
  const connections = await prisma.bankConnection.findMany({
    where: { userId, consentStatus: 'active', provider: 'truelayer' },
    select: {
      id: true,
      userId: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
      consentScopes: true,
      providerConsentId: true,
    },
  })

  if (connections.length === 0) {
    return { connections: 0, transactionsImported: 0, errors: 0 }
  }

  const provider = new TrueLayerProvider(
    config.TRUELAYER_CLIENT_ID,
    config.TRUELAYER_CLIENT_SECRET,
    config.TRUELAYER_REDIRECT_URI,
    config.TRUELAYER_ENVIRONMENT,
  )

  let transactionsImported = 0
  let errors = 0
  for (const conn of connections) {
    try {
      const accessToken = decrypt(Buffer.from(conn.accessTokenEnc), config.ENCRYPTION_KEY).toString('utf-8')
      const refreshToken = conn.refreshTokenEnc
        ? decrypt(Buffer.from(conn.refreshTokenEnc), config.ENCRYPTION_KEY).toString('utf-8')
        : undefined
      const consent: ProviderConsent = {
        providerConsentId: conn.providerConsentId,
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(conn.tokenExpiresAt ? { tokenExpiresAt: conn.tokenExpiresAt } : {}),
        scopes: conn.consentScopes,
      }
      const result = await runFullSync(prisma, conn.id, conn.userId, consent, provider)
      transactionsImported += result.transactionsImported ?? 0
    } catch (err) {
      errors++
      logger.error({ err, connectionId: conn.id }, 'On-demand refresh failed for connection')
    }
  }

  return { connections: connections.length, transactionsImported, errors }
}
