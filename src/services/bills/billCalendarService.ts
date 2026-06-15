/**
 * Bill payment calendar service.
 *
 * Shows upcoming direct debits and subscriptions for the next 30 days,
 * with affordability warnings based on current account balance.
 *
 * Uses the RecurringPayment model (populated by recurringPaymentDetector).
 */
import type { PrismaClient } from '@prisma/client'

const fmt = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const LOOKAHEAD_DAYS = 30

interface UpcomingBill {
  merchantName: string
  amount: number
  dueDate: Date
  frequency: string
}

function addFrequency(date: Date, frequency: string): Date {
  const d = new Date(date)
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7);    break
    case 'fortnightly': d.setDate(d.getDate() + 14); break
    case 'monthly':   d.setMonth(d.getMonth() + 1);  break
    case 'quarterly': d.setMonth(d.getMonth() + 3);  break
    case 'annual':    d.setFullYear(d.getFullYear() + 1); break
    default:          d.setMonth(d.getMonth() + 1);  break
  }
  return d
}

export async function getUpcomingBills(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const now = new Date()
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + LOOKAHEAD_DAYS)

  // Get recurring payments with a next expected date within the window
  const recurring = await prisma.recurringPayment.findMany({
    where: {
      userId,
      isActive: true,
    },
    select: {
      merchantName: true,
      typicalAmount: true,
      frequency: true,
      nextExpectedDate: true,
    },
    orderBy: { nextExpectedDate: 'asc' },
  })

  if (recurring.length === 0) {
    return (
      `I haven't detected any regular bills or subscriptions yet.\n\n` +
      `Connect your bank and let me analyse a few months of transactions — ` +
      `I'll automatically spot your direct debits and subscriptions.`
    )
  }

  // Build list of upcoming bills within lookahead window
  const upcoming: UpcomingBill[] = []
  for (const r of recurring) {
    let date = r.nextExpectedDate ?? now
    // Walk forward from nextExpectedDate to find occurrences in the window
    // (in case nextExpectedDate is in the past)
    while (date < now) {
      date = addFrequency(date, r.frequency)
    }
    if (date <= horizon) {
      upcoming.push({
        merchantName: r.merchantName,
        amount: Number(r.typicalAmount),
        dueDate: date,
        frequency: r.frequency,
      })
    }
  }

  // Get current balance for affordability check
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { currentBalance: true },
  })
  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0)
  const totalUpcoming = upcoming.reduce((sum, b) => sum + b.amount, 0)

  if (upcoming.length === 0) {
    return (
      `You have *${recurring.length} recurring payment${recurring.length !== 1 ? 's' : ''}* on file, ` +
      `but none are due in the next ${LOOKAHEAD_DAYS} days. 🎉\n\n` +
      `Your current balance: *${fmt(totalBalance)}*`
    )
  }

  const today = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const horizonStr = horizon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  let out = `📅 *Upcoming bills (${today} – ${horizonStr})*\n\n`

  for (const bill of upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())) {
    const dateStr = bill.dueDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    const daysUntil = Math.round((bill.dueDate.getTime() - now.getTime()) / 86_400_000)
    const when = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`
    out += `• *${bill.merchantName}* — ${fmt(bill.amount)} due ${dateStr} (${when})\n`
  }

  out += `\n*Total due:* ${fmt(totalUpcoming)}`
  out += `\n*Current balance:* ${fmt(totalBalance)}`

  // Affordability warning
  const balanceAfter = totalBalance - totalUpcoming
  if (balanceAfter < 0) {
    out += `\n\n⚠️ *Heads up:* your upcoming bills (${fmt(totalUpcoming)}) exceed your current balance (${fmt(totalBalance)}). You may need to top up to avoid missed payments.`
  } else if (balanceAfter < totalUpcoming * 0.5) {
    out += `\n\n💡 After these payments, your balance would be *${fmt(balanceAfter)}* — a bit tight. Worth keeping an eye on.`
  }

  return out
}

export function isBillCalendarRequest(message: string): boolean {
  return /upcoming\s+(?:bills?|payments?|direct\s+debits?|DDs?)|(?:bills?|payments?)\s+\w*\s*(?:due|coming|this\s+month)|when\s+(?:are|is)\s+(?:my\s+)?(?:bills?|payments?|next\s+payment)|direct\s+debit\s+calendar|subscription\s+(?:calendar|schedule|due)/i.test(message)
}
