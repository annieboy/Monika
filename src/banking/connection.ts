import type { PrismaClient, BankConnection } from '@prisma/client'
import { encrypt } from '../lib/crypto.js'
import { config } from '../config.js'
import { MockOpenBankingProvider, MOCK_CONSENT } from './providers/mock.js'
import { runFullSync } from './sync.js'
import type { SyncResult } from './sync.js'

export interface MockConnectionResult {
  connection: BankConnection
  syncResult: SyncResult
}

/**
 * Creates a mock bank connection for a user and immediately syncs
 * 90 days of transaction history. Intended for sandbox / demo use.
 *
 * In a real OAuth flow this would be split into two steps:
 *   1. initiateConsent → redirect user to bank
 *   2. handleCallback → exchange code for tokens, store, sync
 */
export async function createMockConnection(
  prisma: PrismaClient,
  userId: string,
): Promise<MockConnectionResult> {
  const provider = new MockOpenBankingProvider()
  const consent = MOCK_CONSENT

  // Encrypt tokens before storing — AES-256-GCM, application-layer.
  // Cast to Uint8Array<ArrayBuffer>: Buffer is always backed by ArrayBuffer
  // at runtime; the TS type says ArrayBufferLike, but Prisma requires the
  // narrower ArrayBuffer generic.
  const accessTokenEnc = encrypt(
    Buffer.from(consent.accessToken, 'utf-8'),
    config.ENCRYPTION_KEY,
  ) as unknown as Uint8Array<ArrayBuffer>
  const refreshTokenEnc = consent.refreshToken
    ? (encrypt(Buffer.from(consent.refreshToken, 'utf-8'), config.ENCRYPTION_KEY) as unknown as Uint8Array<ArrayBuffer>)
    : null

  // Upsert the connection — idempotent if called twice for the same user+consent
  const connection = await prisma.bankConnection.upsert({
    where: {
      userId_providerConsentId: {
        userId,
        providerConsentId: consent.providerConsentId,
      },
    },
    create: {
      userId,
      provider: 'mock',
      providerConsentId: consent.providerConsentId,
      bankId: 'mock-bank',
      bankDisplayName: 'Mock Bank (Sandbox)',
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt: consent.tokenExpiresAt ?? null,
      consentStatus: 'active',
      consentScopes: consent.scopes,
    },
    update: {
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt: consent.tokenExpiresAt ?? null,
      consentStatus: 'active',
    },
  })

  const syncResult = await runFullSync(prisma, connection.id, userId, consent, provider)

  // Mark the user as active after a successful bank connection
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStatus: 'active' },
  })

  return { connection, syncResult }
}
