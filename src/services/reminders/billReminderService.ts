/**
 * Proactive bill reminder service.
 *
 * Runs daily at 08:00 via BullMQ. For each user with an active bank connection,
 * checks whether any recurring payment is estimated to fall due in the next 3 days.
 * Sends a single consolidated WhatsApp message.
 *
 * Rate-limited: one reminder per user per 6 days, tracked via audit_log.
 */
import type { PrismaClient } from '@prisma/client'
import { logger } from '../../logger.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { decrypt } from '../../lib/crypto.js'

const REMINDER_WINDOW_DAYS = 3
const MIN_DAYS_BETWEEN_REMINDERS = 6

export interface BillReminderResult {
  processed: number
  reminded: number
  errors: number
}

interface DueBill {
  merchantName: string
  dayOfMonth: number
  amount: number
}

function isDueWithinDays(dayOfMonth: number, windowDays: number): boolean {
  const today = new Date()
  const todayDay = today.getDate()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  for (let d = 0; d <= windowDays; d++) {
    if (((todayDay - 1 + d) % daysInMonth) + 1 === dayOfMonth) return true
  }
  return false
}

function buildMessage(bills: DueBill[]): string {
  const fmtAmt = (n: number) => `£${n.toFixed(2)}`
  const total = bills.reduce((s, b) => s + b.amount, 0)
  let msg = `Heads up! You have ${bills.length === 1 ? 'a payment' : 'payments'} due in the next ${REMINDER_WINDOW_DAYS} days:\n\n`
  for (const b of bills) msg += `• ${b.merchantName}: ${fmtAmt(b.amount)}\n`
  msg += `\nTotal: ${fmtAmt(total)}\n\nMake sure you have enough in your account! 💳`
  return msg
}

async function getPhone(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsappPhoneEnc: true } })
  if (!user?.whatsappPhoneEnc) return null
  return decrypt(Buffer.from(user.whatsappPhoneEnc), config.ENCRYPTION_KEY).toString('utf-8')
}

async function wasRemindedRecently(prisma: PrismaClient, userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN_REMINDERS * 86_400_000)
  const hit = await prisma.auditLog.findFirst({
    where: { userId, eventType: 'bill_reminder_sent', createdAt: { gt: cutoff } },
    select: { id: true },
  })
  return !!hit
}

export async function runBillReminderBatch(prisma: PrismaClient): Promise<BillReminderResult> {
  const activeUsers = await prisma.bankConnection.findMany({
    where: { consentStatus: 'active' },
    distinct: ['userId'],
    select: { userId: true },
  })

  let reminded = 0
  let errors = 0

  for (const { userId } of activeUsers) {
    try {
      if (await wasRemindedRecently(prisma, userId)) continue

      const recurring = await prisma.recurringPayment.findMany({
        where: { userId, status: 'active' },
        select: { merchantName: true, lastSeenDate: true, averageAmount: true },
      })

      const due: DueBill[] = recurring
        .filter((p) => isDueWithinDays(p.lastSeenDate.getDate(), REMINDER_WINDOW_DAYS))
        .map((p) => ({
          merchantName: p.merchantName,
          dayOfMonth: p.lastSeenDate.getDate(),
          amount: Math.abs(Number(p.averageAmount)),
        }))

      if (due.length === 0) continue

      const phone = await getPhone(prisma, userId)
      if (!phone) continue

      await sendWhatsAppMessage(phone, buildMessage(due), config.WHATSAPP_PHONE_NUMBER_ID, config.WHATSAPP_ACCESS_TOKEN)
      await prisma.auditLog.create({
        data: { userId, eventType: 'bill_reminder_sent', eventData: { count: due.length, merchants: due.map(b => b.merchantName) } },
      })
      reminded++
    } catch (err) {
      errors++
      logger.error({ err, userId }, 'Bill reminder failed')
    }
  }

  return { processed: activeUsers.length, reminded, errors }
}
