/**
 * Background sync scheduler.
 *
 * Runs once every 6 hours to refresh tokens and sync transactions for all
 * active bank connections. Ensures data stays current even when users
 * haven't messaged recently, and prevents token expiry.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt, encrypt } from '../../lib/crypto.js'
import { TrueLayerProvider } from '../../banking/providers/truelayer.js'
import { runFullSync } from '../../banking/sync.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'
import type { ProviderConsent } from '../../banking/types.js'

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

export function startSyncScheduler(prisma: PrismaClient): NodeJS.Timeout {
  const interval = setInterval(() => {
    runScheduledSync(prisma).catch((err: unknown) => {
      logger.error({ err }, 'Scheduled sync failed')
    })
  }, SYNC_INTERVAL_MS)

  // Don't keep the process alive for the scheduler alone
  interval.unref()

  logger.info({ intervalHours: 6 }, 'Background sync scheduler started')
  return interval
}

async function runScheduledSync(prisma: PrismaClient): Promise<void> {
  if (!config.TRUELAYER_CLIENT_ID || !config.TRUELAYER_CLIENT_SECRET) return

  const connections = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active', provider: 'truelayer' },
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

  logger.info({ count: connections.length }, 'Running scheduled sync')

  const provider = new TrueLayerProvider(
    config.TRUELAYER_CLIENT_ID,
    config.TRUELAYER_CLIENT_SECRET,
    config.TRUELAYER_REDIRECT_URI,
    config.TRUELAYER_ENVIRONMENT,
  )

  for (const conn of connections) {
    try {
      const accessToken = decrypt(
        Buffer.from(conn.accessTokenEnc),
        config.ENCRYPTION_KEY,
      ).toString('utf-8')

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

      logger.info(
        { connectionId: conn.id, userId: conn.userId, ...result },
        'Scheduled sync completed',
      )
    } catch (err) {
      // Mark connection as error but continue syncing others
      logger.error({ err, connectionId: conn.id }, 'Scheduled sync failed for connection')
      await prisma.bankConnection.update({
        where: { id: conn.id },
        data: { lastSyncStatus: 'error', lastSyncError: err instanceof Error ? err.message : String(err) },
      }).catch(() => undefined)
    }
  }
}
