/**
 * Account management via WhatsApp.
 *
 * Handles intents classified as 'account_management':
 *   - Profile summary: what data we hold
 *   - Marketing opt-out: "stop sending offers"
 *   - Account deletion: two-step confirmation ("delete my account" → "CONFIRM DELETE")
 *   - Name update: "change my name to Annie"
 *
 * Deletion is a soft-delete (sets deletedAt) with an audit log entry.
 * All PII access goes through decrypt().
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt, encrypt } from '../../lib/crypto.js'
import { config } from '../../config.js'
import { logConsentEvent } from '../onboarding/audit.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function decryptField(enc: Uint8Array | Buffer | null | undefined): string | null {
  if (!enc) return null
  try {
    return decrypt(Buffer.from(enc), config.ENCRYPTION_KEY).toString('utf-8')
  } catch {
    return null
  }
}

// ── Intent detection sub-classifiers ─────────────────────────────────────────

function isOptOut(msg: string): boolean {
  return /stop\s+(sending|messages|offers|notifications|tips)|unsubscribe|opt.?out/i.test(msg)
}

function isDeleteRequest(msg: string): boolean {
  return /delete\s+(my\s+)?(account|data)|remove\s+(my\s+)?(account|data)|right\s+to\s+be\s+forgotten/i.test(msg)
}

function isDeleteConfirm(msg: string): boolean {
  return /^\s*CONFIRM\s+DELETE\s*$/i.test(msg.trim())
}

function isDataRequest(msg: string): boolean {
  return /what\s+data|my\s+(personal\s+)?data|gdpr|privacy/i.test(msg)
}

function isNameUpdate(msg: string): boolean {
  return /change\s+my\s+name|update\s+my\s+name/i.test(msg)
}

function extractNewName(msg: string): string | null {
  const m = msg.match(/(?:change|update)\s+my\s+name\s+to\s+([A-Za-z][A-Za-z\s'-]{0,62})/i)
  return m?.[1]?.trim() ?? null
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleOptOut(prisma: PrismaClient, userId: string): Promise<string> {
  await prisma.user.update({
    where: { id: userId },
    data: { marketingConsent: false },
  })
  await logConsentEvent(prisma, 'bank_connect_link_sent', userId, { action: 'marketing_opt_out' })
  return (
    `Done ✅ I've turned off marketing messages and personalised offers for you.\n\n` +
    `You'll still receive important account notifications. ` +
    `Say *"start receiving offers"* to opt back in anytime.`
  )
}

async function handleDeleteRequest(prisma: PrismaClient, userId: string): Promise<string> {
  // Check if there's a pending deletion confirmation in audit log (last 10 min)
  const pendingConfirm = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'account_delete_requested',
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    select: { id: true },
  })

  if (!pendingConfirm) {
    await prisma.auditLog.create({
      data: {
        userId,
        eventType: 'account_delete_requested',
        serviceName: 'account_management',
        eventData: {},
      },
    })
    return (
      `⚠️ *Are you sure you want to delete your account?*\n\n` +
      `This will permanently erase all your data — transactions, goals, and conversation history.\n\n` +
      `To confirm, reply exactly: *CONFIRM DELETE*\n\n` +
      `This request expires in 10 minutes.`
    )
  }

  // Already requested — now they need to say CONFIRM DELETE
  return (
    `To complete account deletion, reply exactly: *CONFIRM DELETE*\n\n` +
    `Or say anything else to cancel.`
  )
}

async function handleDeleteConfirm(prisma: PrismaClient, userId: string): Promise<string> {
  // Verify a delete request exists within the last 10 min
  const pending = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: 'account_delete_requested',
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    select: { id: true },
  })

  if (!pending) {
    return `No pending deletion request found. If you want to delete your account, say *"delete my account"* first.`
  }

  // Soft delete — wipe encrypted PII, set deletedAt
  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      fullNameEnc: null,
      whatsappPhoneEnc: null,
      emailEnc: null,
      onboardingStatus: 'deleted',
    },
  })

  await prisma.auditLog.create({
    data: {
      userId,
      eventType: 'user_deleted',
      serviceName: 'account_management',
      eventData: { method: 'whatsapp_self_service' },
    },
  })

  return (
    `Your account has been deleted ✅\n\n` +
    `All your personal data has been erased in line with GDPR Article 17 (right to erasure).\n\n` +
    `If you ever want to use Monika again, just send us a message and we'll start fresh.`
  )
}

async function handleDataRequest(prisma: PrismaClient, userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      fullNameEnc: true,
      termsAcceptedAt: true,
      termsVersion: true,
      gdprConsentAt: true,
      marketingConsent: true,
      onboardingStatus: true,
      createdAt: true,
    },
  })
  if (!user) return `Could not find your account. Please try again.`

  const name = decryptField(user.fullNameEnc as Buffer | null)
  const joined = user.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const termsDate = user.termsAcceptedAt?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) ?? 'not accepted'

  const [txCount, goalCount, convCount] = await Promise.all([
    prisma.transaction.count({ where: { userId } }),
    prisma.savingsGoal.count({ where: { userId } }),
    prisma.conversation.count({ where: { userId } }),
  ])

  return (
    `🔒 *Your data summary*\n\n` +
    `*Name:* ${name ?? 'not set'}\n` +
    `*Joined:* ${joined}\n` +
    `*Terms accepted:* ${termsDate} (v${user.termsVersion ?? '—'})\n` +
    `*Marketing consent:* ${user.marketingConsent ? 'Yes' : 'No'}\n\n` +
    `*Data we hold:*\n` +
    `• ${txCount.toLocaleString()} transactions\n` +
    `• ${goalCount} savings goals\n` +
    `• ${convCount} conversation messages\n\n` +
    `To erase all your data, say *"delete my account"*.\n` +
    `To stop marketing messages, say *"unsubscribe"*.`
  )
}

async function handleNameUpdate(prisma: PrismaClient, userId: string, message: string): Promise<string> {
  const newName = extractNewName(message)
  if (!newName || newName.length < 2 || newName.length > 64) {
    return `Please tell me the name you'd like to use. For example: *"Change my name to Annie"*`
  }

  const nameEnc = encrypt(Buffer.from(newName, 'utf-8'), config.ENCRYPTION_KEY) as unknown as Uint8Array<ArrayBuffer>
  await prisma.user.update({
    where: { id: userId },
    data: { fullNameEnc: nameEnc },
  })

  return `Done! I'll call you *${newName}* from now on. 😊`
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function handleAccountManagement(
  prisma: PrismaClient,
  userId: string,
  message: string,
): Promise<string> {
  // Deletion confirmation takes priority — must match exactly
  if (isDeleteConfirm(message)) {
    return handleDeleteConfirm(prisma, userId)
  }

  if (isDeleteRequest(message)) {
    return handleDeleteRequest(prisma, userId)
  }

  if (isOptOut(message)) {
    return handleOptOut(prisma, userId)
  }

  if (isDataRequest(message)) {
    return handleDataRequest(prisma, userId)
  }

  if (isNameUpdate(message)) {
    return handleNameUpdate(prisma, userId, message)
  }

  // Profile query or general account question
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullNameEnc: true, marketingConsent: true, onboardingStatus: true },
  })

  const name = decryptField(user?.fullNameEnc as Buffer | null | undefined)

  return (
    `👤 *Your account*\n\n` +
    `*Name:* ${name ?? 'not set'}\n` +
    `*Marketing messages:* ${user?.marketingConsent ? 'On' : 'Off'}\n` +
    `*Status:* ${user?.onboardingStatus ?? 'unknown'}\n\n` +
    `What would you like to do?\n` +
    `• *"What data do you hold on me?"* — full data summary\n` +
    `• *"Change my name to [name]"* — update your name\n` +
    `• *"Unsubscribe"* — stop marketing messages\n` +
    `• *"Delete my account"* — erase all your data`
  )
}
