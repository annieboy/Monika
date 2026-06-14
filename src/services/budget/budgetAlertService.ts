/**
 * Proactive budget alert service.
 *
 * Runs daily. For each user with budgets set, checks category spend this month
 * against each budget limit. Sends a WhatsApp alert at two thresholds:
 *   - 80% of budget reached (warning)
 *   - 100% of budget exceeded (over-budget)
 *
 * Rate-limited per category per threshold per month via auditLog to prevent
 * duplicate sends on retries.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../whatsapp/sender.js'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface BudgetAlertResult {
  alerted: number
  errors: number
}

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

function buildWarningMessage(category: string, spent: number, limit: number): string {
  const pct = Math.round((spent / limit) * 100)
  const remaining = limit - spent
  return (
    `⚠️ *Budget warning — ${category}*\n\n` +
    `You've used *${pct}%* of your ${fmt(limit)} budget (spent ${fmt(spent)}).\n` +
    `You have *${fmt(remaining)}* left for the rest of the month.\n\n` +
    `Reply *"my budgets"* to see all your limits.`
  )
}

function buildExceededMessage(category: string, spent: number, limit: number): string {
  const over = spent - limit
  return (
    `🚨 *Budget exceeded — ${category}*\n\n` +
    `You've spent *${fmt(spent)}* against a ${fmt(limit)} budget — ` +
    `*${fmt(over)} over*.\n\n` +
    `Reply *"my budgets"* to review or adjust your limits.`
  )
}

interface BudgetRow {
  category: string
  amount: number
}

async function getActiveBudgets(prisma: PrismaClient, userId: string): Promise<BudgetRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId, eventType: 'budget_set' },
    orderBy: { createdAt: 'desc' },
    select: { eventData: true },
  })

  // Latest per category (event-sourcing: first occurrence per category wins when iterating desc)
  const seen = new Set<string>()
  const budgets: BudgetRow[] = []
  for (const row of rows) {
    const data = row.eventData as { category?: string; amount?: number }
    if (!data.category || data.amount == null) continue
    if (seen.has(data.category)) continue
    seen.add(data.category)
    budgets.push({ category: data.category, amount: data.amount })
  }
  return budgets
}

async function alreadySentThisMonth(
  prisma: PrismaClient,
  userId: string,
  category: string,
  alertType: 'budget_80pct_alert' | 'budget_exceeded_alert',
): Promise<boolean> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const existing = await prisma.auditLog.findFirst({
    where: {
      userId,
      eventType: alertType,
      eventData: { path: ['category'], equals: category },
      createdAt: { gte: monthStart },
    },
    select: { id: true },
  })
  return existing !== null
}

export async function runBudgetAlertBatch(prisma: PrismaClient): Promise<BudgetAlertResult> {
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = config.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) {
    logger.warn('Budget alerts: WhatsApp credentials not configured, skipping')
    return { alerted: 0, errors: 0 }
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const users = await prisma.user.findMany({
    where: {
      bankConnections: { some: { consentStatus: 'active' } },
      termsAcceptedAt: { not: null },
    },
    select: { id: true },
  })

  let alerted = 0
  let errors = 0

  for (const user of users) {
    try {
      const budgets = await getActiveBudgets(prisma, user.id)
      if (budgets.length === 0) continue

      // Get this month's spend by category
      const categorySpend = await prisma.transaction.groupBy({
        by: ['category'],
        where: {
          userId: user.id,
          transactionDate: { gte: monthStart, lte: now },
          amount: { lt: 0 },
          category: { not: null },
        },
        _sum: { amount: true },
      })

      const spendMap = new Map<string, number>()
      for (const row of categorySpend) {
        if (row.category) {
          spendMap.set(row.category.toLowerCase(), Math.abs(Number(row._sum.amount ?? 0)))
        }
      }

      for (const budget of budgets) {
        const spent = spendMap.get(budget.category.toLowerCase()) ?? 0
        const pct = spent / budget.amount

        if (pct >= 1.0) {
          const alreadySent = await alreadySentThisMonth(prisma, user.id, budget.category, 'budget_exceeded_alert')
          if (alreadySent) continue

          const phone = await getPhone(prisma, user.id)
          if (!phone) continue

          const msg = buildExceededMessage(budget.category, spent, budget.amount)
          await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)
          await prisma.auditLog.create({
            data: {
              userId: user.id,
              eventType: 'budget_exceeded_alert',
              serviceName: 'budget-alerts',
              eventData: { category: budget.category, spent, limit: budget.amount },
            },
          })
          alerted++
          logger.info({ userId: user.id, category: budget.category }, 'Budget exceeded alert sent')
        } else if (pct >= 0.8) {
          const alreadySent = await alreadySentThisMonth(prisma, user.id, budget.category, 'budget_80pct_alert')
          if (alreadySent) continue

          const phone = await getPhone(prisma, user.id)
          if (!phone) continue

          const msg = buildWarningMessage(budget.category, spent, budget.amount)
          await sendWhatsAppMessage(phone, msg, phoneNumberId, accessToken)
          await prisma.auditLog.create({
            data: {
              userId: user.id,
              eventType: 'budget_80pct_alert',
              serviceName: 'budget-alerts',
              eventData: { category: budget.category, spent, limit: budget.amount },
            },
          })
          alerted++
          logger.info({ userId: user.id, category: budget.category }, 'Budget 80% alert sent')
        }
      }
    } catch (err) {
      errors++
      logger.error({ err, userId: user.id }, 'Budget alert failed for user')
    }
  }

  return { alerted, errors }
}
