import type { PrismaClient } from '@prisma/client'
import { layout, esc, fmtDate, paginate } from '../layout.js'

const PAGE_SIZE = 50

export async function auditLogPage(prisma: PrismaClient, query: Record<string, string>): Promise<string> {
  const page = Math.max(1, Number(query['page'] ?? 1))
  const eventType = query['eventType'] ?? ''
  const userId = query['userId'] ?? ''
  const fromDate = query['from'] ? new Date(query['from']) : undefined
  const toDate = query['to'] ? new Date(query['to'] + 'T23:59:59Z') : undefined

  const where = {
    ...(eventType ? { eventType } : {}),
    ...(userId ? { userId } : {}),
    ...((fromDate || toDate) ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
  }

  const [events, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { id: true, whatsappPhoneHash: true } } },
    }),
    prisma.auditLog.count({ where }),
  ])

  // Distinct event types for filter dropdown
  const eventTypes = await prisma.auditLog.groupBy({ by: ['eventType'], orderBy: { eventType: 'asc' } })

  const typeOptions = eventTypes
    .map(
      (e) =>
        `<option value="${esc(e.eventType)}" ${eventType === e.eventType ? 'selected' : ''}>${esc(e.eventType)}</option>`,
    )
    .join('')

  const rows = events
    .map((e) => {
      const userLink = e.user
        ? `<a class="row-link" href="/admin/users/${e.user.id}"><span class="mono">${e.user.whatsappPhoneHash.slice(0, 12)}…</span></a>`
        : '—'
      const dataStr = e.eventData ? JSON.stringify(e.eventData) : ''
      const dataTrunc = dataStr.length > 80 ? dataStr.slice(0, 80) + '…' : dataStr
      return `<tr>
        <td>${String(e.id)}</td>
        <td><span class="mono">${esc(e.eventType)}</span></td>
        <td>${userLink}</td>
        <td><span class="mono" style="font-size:.75rem">${esc(dataTrunc)}</span></td>
        <td>${esc(e.serviceName ?? '—')}</td>
        <td>${fmtDate(e.createdAt)}</td>
      </tr>`
    })
    .join('')

  const activeFilters = [eventType, userId, fromDate, toDate].some(Boolean)

  const body = `
    <form class="search-bar" method="GET" action="/admin/audit" style="align-items:center;flex-wrap:wrap;gap:.5rem">
      <select name="eventType" style="padding:.5rem .875rem;border:1px solid #e2e8f0;border-radius:.5rem;font-size:.875rem">
        <option value="">All event types</option>
        ${typeOptions}
      </select>
      <input name="userId" placeholder="User ID" value="${esc(userId)}" style="padding:.5rem .875rem;border:1px solid #e2e8f0;border-radius:.5rem;font-size:.875rem;width:13rem" />
      <input type="date" name="from" value="${esc(query['from'] ?? '')}" style="padding:.5rem .875rem;border:1px solid #e2e8f0;border-radius:.5rem;font-size:.875rem" />
      <input type="date" name="to" value="${esc(query['to'] ?? '')}" style="padding:.5rem .875rem;border:1px solid #e2e8f0;border-radius:.5rem;font-size:.875rem" />
      <button type="submit">Filter</button>
      ${activeFilters ? `<a href="/admin/audit" style="padding:.5rem .875rem;color:#64748b;font-size:.875rem">Clear</a>` : ''}
    </form>

    <div class="card">
      <div class="card-title">Audit log (${total} events)</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Event</th><th>User</th><th>Data</th><th>Service</th><th>Time</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6">No events</td></tr>'}</tbody>
        </table>
      </div>
      ${paginate(total, page, PAGE_SIZE, (() => {
        const params = new URLSearchParams()
        if (eventType) params.set('eventType', eventType)
        if (userId) params.set('userId', userId)
        if (query['from']) params.set('from', query['from'])
        if (query['to']) params.set('to', query['to'])
        const qs = params.toString()
        return qs ? `/admin/audit?${qs}` : '/admin/audit'
      })())}
    </div>
  `

  return layout(
    'Audit Log',
    body,
    [{ label: 'Dashboard', href: '/admin' }, { label: 'Audit Log' }],
  )
}
