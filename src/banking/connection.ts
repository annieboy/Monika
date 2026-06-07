import type { PrismaClient, BankConnection } from '@prisma/client'
import { encrypt } from '../lib/crypto.js'
import { config } from '../config.js'
import { MockOpenBankingProvider, MOCK_CONSENT } from './providers/mock.js'
import { TrueLayerProvider } from './providers/truelayer.js'
import { runFullSync } from './sync.js'
import type { SyncResult } from './sync.js'
import type { ProviderConsent, OpenBankingProvider } from './types.js'

export interface MockConnectionResult {
  connection: BankConnection
  syncResult: SyncResult
}

// ── Provider factory ───────────────────────────────────────────────────────

/**
 * Returns a TrueLayerProvider when TrueLayer credentials are configured,
 * otherwise falls back to the MockOpenBankingProvider.
 * This lets the app work locally without TrueLayer credentials.
 */
export function resolveProvider(): OpenBankingProvider {
  if (config.TRUELAYER_CLIENT_ID && config.TRUELAYER_CLIENT_SECRET) {
    return new TrueLayerProvider(
      config.TRUELAYER_CLIENT_ID,
      config.TRUELAYER_CLIENT_SECRET,
      config.TRUELAYER_REDIRECT_URI,
      config.TRUELAYER_ENVIRONMENT,
    )
  }
  return new MockOpenBankingProvider()
}

// ── Shared connection persistence ──────────────────────────────────────────

async function persistConnection(
  prisma: PrismaClient,
  userId: string,
  consent: ProviderConsent,
  providerName: string,
  bankId: string,
  bankDisplayName: string,
): Promise<BankConnection> {
  const accessTokenEnc = encrypt(
    Buffer.from(consent.accessToken, 'utf-8'),
    config.ENCRYPTION_KEY,
  ) as unknown as Uint8Array<ArrayBuffer>

  const refreshTokenEnc = consent.refreshToken
    ? (encrypt(
        Buffer.from(consent.refreshToken, 'utf-8'),
        config.ENCRYPTION_KEY,
      ) as unknown as Uint8Array<ArrayBuffer>)
    : null

// Map providerName to the Prisma enum. 
  const prismaProvider =
    providerName.toLowerCase() === 'mock'
      ? ('mock' as const)
      : providerName.toLowerCase().startsWith('truelayer')
        ? ('truelayer' as const)
        : ('mock' as const)

  return prisma.bankConnection.upsert({
    where: { userId_providerConsentId: { userId, providerConsentId: consent.providerConsentId } },
    create: {
      userId,
      provider: prismaProvider,
      providerConsentId: consent.providerConsentId,
      bankId,
      bankDisplayName,
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
}

// ── Mock connection (local dev / tests) ────────────────────────────────────

/**
 * Creates a mock bank connection and immediately syncs 90 days of
 * deterministic transaction history. No OAuth required.
 */
export async function createMockConnection(
  prisma: PrismaClient,
  userId: string,
): Promise<MockConnectionResult> {
  const provider = new MockOpenBankingProvider()
  const consent = MOCK_CONSENT

  const connection = await persistConnection(
    prisma,
    userId,
    consent,
    'mock',
    'mock-bank',
    'Mock Bank (Sandbox)',
  )

  const syncResult = await runFullSync(prisma, connection.id, userId, consent, provider)

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStatus: 'active' },
  })

  return { connection, syncResult }
}

// ── TrueLayer connection (after OAuth callback) ────────────────────────────

/**
 * Persists a TrueLayer bank connection after the OAuth callback and runs
 * an initial full sync. Called from /banking/callback.
 */
export async function createTrueLayerConnection(
  prisma: PrismaClient,
  userId: string,
  consent: ProviderConsent,
  provider: OpenBankingProvider,
  bankDisplayName = 'Your Bank',
): Promise<MockConnectionResult> {
  const connection = await persistConnection(
    prisma,
    userId,
    consent,
    provider.providerName,
    'truelayer',
    bankDisplayName,
  )

  const syncResult = await runFullSync(prisma, connection.id, userId, consent, provider)

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStatus: 'active' },
  })

  return { connection, syncResult }
}
