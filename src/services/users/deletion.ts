/**
 * User deletion service — GDPR Article 17 (Right to Erasure).
 *
 * Hard-deletes all personal data for a user:
 *   1. Revokes all active TrueLayer bank connections
 *   2. Nulls out all encrypted PII fields
 *   3. Sets deletedAt timestamp (soft-delete marker)
 *   4. Appends an immutable audit event
 *
 * Does NOT delete transactions or audit logs — these are required for
 * fraud prevention and regulatory compliance (FCA/PSD2 obligations).
 */
import type { PrismaClient } from '@prisma/client'
import { TrueLayerProvider } from '../../banking/providers/truelayer.js'
import { decrypt } from '../../lib/crypto.js'
import { logConsentEvent } from '../onboarding/audit.js'
import { config } from '../../config.js'

export interface DeletionResult {
  connectionsRevoked: number
  revokeErrors: string[]
}

export async function deleteUser(
  prisma: PrismaClient,
  userId: string,
): Promise<DeletionResult> {
  const revokeErrors: string[] = []
  let connectionsRevoked = 0

  // ── Step 1: Revoke all active TrueLayer connections ─────────────────────
  const connections = await prisma.bankConnection.findMany({
    where: { userId, consentStatus: 'active', provider: 'truelayer' },
    select: { id: true, accessTokenEnc: true },
  })

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
      await provider.revokeConsent(accessToken)
      connectionsRevoked++
    } catch (err) {
      revokeErrors.push(
        `connection ${conn.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Mark all connections revoked regardless of API result
  await prisma.bankConnection.updateMany({
    where: { userId },
    data: { consentStatus: 'revoked' },
  })

  // ── Step 2: Null out all encrypted PII ──────────────────────────────────
  await prisma.user.update({
    where: { id: userId },
    data: {
      whatsappPhoneEnc: null,
      fullNameEnc: null,
      emailEnc: null,
      deletedAt: new Date(),
    },
  })

  // ── Step 3: Audit log ────────────────────────────────────────────────────
  await logConsentEvent(prisma, 'user_deleted', userId, {
    connectionsRevoked,
    revokeErrors: revokeErrors.length > 0 ? revokeErrors : undefined,
  })

  return { connectionsRevoked, revokeErrors }
}

export async function exportUserData(
  prisma: PrismaClient,
  userId: string,
): Promise<Record<string, unknown>> {
  const [user, connections, transactions, conversations, auditEvents] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        createdAt: true,
        onboardingStatus: true,
        termsAcceptedAt: true,
        termsVersion: true,
        gdprConsentAt: true,
        marketingConsent: true,
      },
    }),
    prisma.bankConnection.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        bankDisplayName: true,
        consentStatus: true,
        consentScopes: true,
        createdAt: true,
        lastSyncAt: true,
      },
    }),
    prisma.transaction.findMany({
      where: { userId },
      select: {
        id: true,
        amount: true,
        currency: true,
        transactionType: true,
        merchantName: true,
        category: true,
        transactionDate: true,
        rawDescription: true,
      },
      orderBy: { transactionDate: 'desc' },
      take: 1000,
    }),
    prisma.conversation.findMany({
      where: { userId },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.auditLog.findMany({
      where: { userId },
      select: { eventType: true, createdAt: true, eventData: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ])

  return {
    exportedAt: new Date().toISOString(),
    profile: user,
    bankConnections: connections,
    transactions,
    conversationHistory: conversations,
    consentHistory: auditEvents,
  }
}
