import type { PrismaClient } from '@prisma/client'
import { layout, fmtDate } from '../layout.js'

export async function dashboardPage(prisma: PrismaClient): Promise<string> {
  const [userCount, txnCount, connCount, msgCount, auditCount] = await Promise.all([
    prisma.user.count(),
    prisma.transaction.count(),
    prisma.bankConnection.count(),
    prisma.conversation.count(),
    prisma.auditLog.count(),
  ])

  const recentAudit = await prisma.auditLog.findMany({
    orderBy: { id: 'desc' },
    take: 8,
    include: { user: { select: { whatsappPhoneHash: true } } },
  })

  const auditRows = recentAudit
    .map(
      (e) => `<tr>
        <td>${String(e.id)}</td>
        <td><span class="mono">${e.eventType}</span></td>
        <td>${e.user ? `<span class="mono">${e.user.whatsappPhoneHash.slice(0, 12)}…</span>` : '—'}</td>
        <td>${fmtDate(e.createdAt)}</td>
      </tr>`,
    )
    .join('')

  const body = `
    <div class="stats">
      <div class="stat"><div class="stat-value">${userCount}</div><div class="stat-label">Users</div></div>
      <div class="stat"><div class="stat-value">${connCount}</div><div class="stat-label">Bank Connections</div></div>
      <div class="stat"><div class="stat-value">${txnCount}</div><div class="stat-label">Transactions</div></div>
      <div class="stat"><div class="stat-value">${msgCount}</div><div class="stat-label">Messages</div></div>
      <div class="stat"><div class="stat-value">${auditCount}</div><div class="stat-label">Audit Events</div></div>
    </div>

    <div class="card">
      <div class="card-title">Recent audit events</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Event</th><th>User hash</th><th>Time</th></tr></thead>
          <tbody>${auditRows || '<tr><td colspan="4">No events yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `

  return layout('Dashboard', body)
}
