/**
 * Monthly subscription audit service.
 *
 * Runs on the 1st of each month. Sends each user a consolidated digest of
 * all their recurring subscriptions with total monthly cost and a prompt
 * to review any they no longer use.
 *
 * Rate-limited: one audit per user per calendar month via auditLog.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface SubscriptionAuditResult {
  processed: number
  sent: number
  errors: number
}

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Only flag subscription-type categories
const SUBSCRIPTION_CATEGORIES = [
  'subscriptions', 'entertainment', 'streaming', 'software', 'saas',
  'broadband', 'mobile', 'insurance', 'membership',
]

function isSubscription(merchantCategory: string): boolean {
  return SUBSCRIPTION_CATEGORIES.some(c => merchantCategory.toLowerCase().includes(c))
}

async function getPhone(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappPhoneEnc: true },
  })
  if (!user?.whatsappPhoneEnc) return null
  try {
    return decrypt(Buffer.from(user.whatsappPhoneEnc), config.ENCRYPTION_KEY).toString('utf-8')
  } catch {
    return null
  }
}

async function wasAuditedThisMonth(prisma: PrismaClient, userId: string): Promise<boolean> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const hit = await prisma.auditLog.findFirst({
    where: { userId, eventType: 'subscription_audit_sent', createdAt: { gte: startOfMonth } },
    select: { id: true },
  })
  return !!hit
}

function buildMessage(subs: Array<{ name: string; monthly: number }>, total: number): string {
  const monthName = new Date().toLocaleString('en-GB', { month: 'long' })
  let msg = `📋 *Your monthly subscription audit — ${monthName}*\n\n`
  msg += `Here's what you're paying for regularly:\n\n`
  for (const s of subs) {
    msg += `• ${s.name}: ${fmt(s.monthly)}/month\n`
  }
  msg += `\n*Total: ${fmt(total)}/month (${fmt(total * 12)}/year)*\n\n`
  msg += `Any you no longer use? Now's a great time to cancel.\n\n`
  msg += `💡 Reply *"should I switch broadband?"* or *"best mobile plan?"* to check if you're on the best deal.`
  return msg
}

export async function runSubscriptionAuditBatch(prisma: PrismaClient): Promise<SubscriptionAuditResult> {
  const activeUsers = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active' },
    distinct: ['userId'],
    select: { userId: true },
  })

  let sent = 0
  let errors = 0

  for (const { userId } of activeUsers) {
    try {
      if (await wasAuditedThisMonth(prisma, userId)) continue

      const recurring = await prisma.recurringPayment.findMany({
        where: { userId, isActive: true },
        select: {
          merchantName: true,
          merchantCategory: true,
          typicalAmount: true,
          frequency: true,
        },
        orderBy: { typicalAmount: 'desc' },
      })

      const subs = recurring
        .filter(r => isSubscription(r.merchantCategory))
        .map(r => {
          const raw = Number(r.typicalAmount)
          const monthly = r.frequency === 'annual' ? raw / 12
            : r.frequency === 'quarterly' ? raw / 3
            : r.frequency === 'weekly' ? raw * 4.33
            : raw
          return { name: r.merchantName, monthly }
        })
        .filter(s => s.monthly > 0)

      if (subs.length === 0) continue

      const total = subs.reduce((s, r) => s + r.monthly, 0)

      const phone = await getPhone(prisma, userId)
      if (!phone) continue

      const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
      const accessToken = config.WHATSAPP_ACCESS_TOKEN
      if (!phoneNumberId || !accessToken) continue

      const msg = buildMessage(subs, total)
      await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)

      await prisma.auditLog.create({
        data: {
          userId,
          eventType: 'subscription_audit_sent',
          eventData: { subscriptionCount: subs.length, totalMonthly: total },
        },
      })

      sent++
      logger.info({ userId, subCount: subs.length, total }, 'Subscription audit sent')
    } catch (err) {
      logger.error({ err, userId }, 'Subscription audit failed for user')
      errors++
    }
  }

  return { processed: activeUsers.length, sent, errors }
}
