import type { PrismaClient } from '@prisma/client'
import { layout, esc, fmtDate, badge, rowLink, paginate } from '../layout.js'
import { hashPhoneNumber } from '../../../lib/crypto.js'
import { config } from '../../../config.js'

const PAGE_SIZE = 30

function onboardingBadge(status: string): string {
  const map: Record<string, 'green' | 'yellow' | 'red' | 'gray'> = {
    active: 'green',
    connecting: 'yellow',
    pending: 'gray',
    suspended: 'red',
    deleted: 'red',
  }
  return badge(status, map[status] ?? 'gray')
}

export async function usersListPage(prisma: PrismaClient, query: Record<string, string>): Promise<string> {
  const page = Math.max(1, Number(query['page'] ?? 1))
  const rawPhone = query['phone'] ?? ''
  const search = query['q'] ?? ''

  // If the user typed a phone number, hash it to search
  let phoneHash: string | undefined
  if (rawPhone.trim()) {
    phoneHash = hashPhoneNumber(rawPhone.trim().replace(/\s+/g, ''), config.SECRET_KEY)
  }

  const where = phoneHash
    ? { whatsappPhoneHash: phoneHash }
    : search
      ? { whatsappPhoneHash: { contains: search.trim() } }
      : {}

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        _count: { select: { bankConnections: true, conversations: true, transactions: true } },
      },
    }),
    prisma.user.count({ where }),
  ])

  const rows = users
    .map(
      (u) => `<tr>
        <td>${rowLink(`/admin/users/${u.id}`, u.id.slice(0, 8) + '…')}</td>
        <td><span class="mono">${esc(u.whatsappPhoneHash.slice(0, 16))}…</span></td>
        <td>${onboardingBadge(u.onboardingStatus)}</td>
        <td>${u._count.bankConnections}</td>
        <td>${u._count.conversations}</td>
        <td>${u._count.transactions}</td>
        <td>${fmtDate(u.createdAt)}</td>
      </tr>`,
    )
    .join('')

  const searchVal = esc(rawPhone || search)
  const body = `
    <form class="search-bar" method="GET" action="/admin/users">
      <input type="text" name="phone" placeholder="Search by phone number (will be hashed)" value="${searchVal}">
      <button type="submit">Search</button>
      ${rawPhone || search ? `<a href="/admin/users" style="padding:.5rem .875rem;color:#64748b;font-size:.875rem">Clear</a>` : ''}
    </form>

    <div class="card">
      <div class="card-title">Users (${total})</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Phone hash</th><th>Status</th>
              <th>Connections</th><th>Messages</th><th>Txns</th><th>Joined</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7">No users found</td></tr>'}</tbody>
        </table>
      </div>
      ${paginate(total, page, PAGE_SIZE, '/admin/users')}
    </div>
  `

  return layout('Users', body, [{ label: 'Dashboard', href: '/admin' }, { label: 'Users' }])
}

export async function userDetailPage(prisma: PrismaClient, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      bankConnections: {
        include: { accounts: true },
        orderBy: { createdAt: 'desc' },
      },
      conversations: {
        orderBy: { createdAt: 'asc' },
        take: 100,
      },
      auditLogs: {
        orderBy: { id: 'desc' },
        take: 50,
      },
      onboardingTokens: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          purpose: true,
          expiresAt: true,
          usedAt: true,
          createdAt: true,
          // Never select the token value itself
        },
      },
      opportunityPreferences: true,
      _count: { select: { transactions: true } },
    },
  })

  if (!user) return null

  // ── Bank connections ──
  const connHtml = user.bankConnections.length
    ? user.bankConnections
        .map((c) => {
          const statusBadge =
            c.consentStatus === 'active' ? badge('active', 'green') : badge(c.consentStatus, 'red')
          const syncBadge =
            c.lastSyncStatus === 'success'
              ? badge('success', 'green')
              : c.lastSyncStatus
                ? badge(c.lastSyncStatus, 'red')
                : badge('never', 'gray')

          const accountRows = c.accounts
            .map(
              (a) => `<tr>
                <td>${rowLink(`/admin/transactions?userId=${user.id}&accountId=${a.id}`, a.displayName ?? a.providerAccountId)}</td>
                <td><span class="badge badge-gray">${esc(a.accountType)}</span></td>
                <td>${a.currentBalance != null ? `£${Number(a.currentBalance).toFixed(2)}` : '—'}</td>
                <td>${a.availableBalance != null ? `£${Number(a.availableBalance).toFixed(2)}` : '—'}</td>
                <td>${a.isPrimary ? badge('primary', 'blue') : ''}</td>
              </tr>`,
            )
            .join('')

          return `<div class="card">
            <div class="card-title">${esc(c.bankDisplayName ?? c.provider)} &nbsp; ${statusBadge}</div>
            <dl class="detail-grid">
              <dt>Provider</dt><dd>${esc(c.provider)}</dd>
              <dt>Bank ID</dt><dd>${esc(c.bankId ?? '—')}</dd>
              <dt>Consent ID</dt><dd><span class="mono">${esc(c.providerConsentId)}</span></dd>
              <dt>Scopes</dt><dd>${(c.consentScopes as string[]).map((s) => badge(s, 'blue')).join(' ')}</dd>
              <dt>Last sync</dt><dd>${fmtDate(c.lastSyncAt)} &nbsp; ${syncBadge}</dd>
              <dt>Connected</dt><dd>${fmtDate(c.createdAt)}</dd>
            </dl>
            ${
              c.accounts.length
                ? `<div style="margin-top:1rem">
              <div class="card-title">Accounts (${c.accounts.length})</div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Type</th><th>Balance</th><th>Available</th><th></th></tr></thead>
                  <tbody>${accountRows}</tbody>
                </table>
              </div>
            </div>`
                : ''
            }
          </div>`
        })
        .join('')
    : '<div class="card"><p style="color:#64748b">No bank connections</p></div>'

  // ── Conversations ──
  const convRows = user.conversations
    .map((m) => {
      const tc = m.toolCalls as Record<string, string> | null
      const intentBadge = tc?.intent ? badge(tc.intent, 'purple') : ''
      const roleBadge = m.role === 'user' ? badge('user', 'blue') : badge('assistant', 'green')
      const content = esc(m.content.length > 120 ? m.content.slice(0, 120) + '…' : m.content)
      return `<tr>
        <td>${roleBadge}</td>
        <td>${content}</td>
        <td>${intentBadge}${tc?.confidence ? `<span style="color:#94a3b8;font-size:.75rem;margin-left:.25rem">${esc(tc.confidence)}</span>` : ''}</td>
        <td>${fmtDate(m.createdAt)}</td>
      </tr>`
    })
    .join('')

  // ── Onboarding tokens ──
  const tokenRows = user.onboardingTokens
    .map(
      (t) => `<tr>
      <td><span class="badge badge-gray">${esc(t.purpose)}</span></td>
      <td>${t.usedAt ? badge('used', 'green') : new Date(t.expiresAt) < new Date() ? badge('expired', 'red') : badge('valid', 'yellow')}</td>
      <td>${fmtDate(t.expiresAt)}</td>
      <td>${t.usedAt ? fmtDate(t.usedAt) : '—'}</td>
      <td>${fmtDate(t.createdAt)}</td>
    </tr>`,
    )
    .join('')

  // ── Audit logs ──
  const auditRows = user.auditLogs
    .map(
      (e) => `<tr>
      <td>${String(e.id)}</td>
      <td><span class="mono">${esc(e.eventType)}</span></td>
      <td><pre class="json" style="margin:0;padding:.25rem .5rem">${esc(JSON.stringify(e.eventData, null, 2))}</pre></td>
      <td>${fmtDate(e.createdAt)}</td>
    </tr>`,
    )
    .join('')

  const body = `
    <div class="card">
      <div class="card-title">User details</div>
      <dl class="detail-grid">
        <dt>ID</dt><dd><span class="mono">${esc(user.id)}</span></dd>
        <dt>Phone hash</dt><dd><span class="mono">${esc(user.whatsappPhoneHash)}</span></dd>
        <dt>WABA ID</dt><dd><span class="mono">${esc(user.whatsappWabaId)}</span></dd>
        <dt>Status</dt><dd>${onboardingBadge(user.onboardingStatus)}</dd>
        <dt>Transactions</dt><dd>${user._count.transactions}</dd>
        <dt>Created</dt><dd>${fmtDate(user.createdAt)}</dd>
        <dt>Updated</dt><dd>${fmtDate(user.updatedAt)}</dd>
      </dl>
      <div style="margin-top:1rem">
        <a class="row-link" href="/admin/transactions?userId=${user.id}">View all transactions →</a>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Opportunity preferences</div>
      ${user.opportunityPreferences ? (() => {
        const p = user.opportunityPreferences
        const consentBadge = p.opportunitiesConsent
          ? badge('opted in', 'green')
          : p.consentWithdrawnAt
            ? badge('opted out', 'red')
            : badge('no response', 'gray')
        const coolingOff = p.coolingOffUntil && p.coolingOffUntil > new Date()
          ? `${badge('cooling off', 'yellow')} until ${fmtDate(p.coolingOffUntil)}`
          : '—'
        return `<dl class="detail-grid">
          <dt>Consent</dt><dd>${consentBadge}</dd>
          <dt>Opted in at</dt><dd>${fmtDate(p.consentGivenAt)}</dd>
          <dt>Opted out at</dt><dd>${p.consentWithdrawnAt ? fmtDate(p.consentWithdrawnAt) : '—'}</dd>
          <dt>Method</dt><dd>${p.consentMethod ? esc(p.consentMethod) : '—'}</dd>
          <dt>Cooling off</dt><dd>${coolingOff}</dd>
          <dt>Last message sent</dt><dd>${fmtDate(p.lastMessageSentAt)}</dd>
          <dt>Weekly cap</dt><dd>${p.maxMessagesPerWeek} / week</dd>
          <dt>Monthly cap</dt><dd>${p.maxMessagesPerMonth} / month</dd>
          <dt>Quiet hours</dt><dd>${esc(p.quietHoursStart)} – ${esc(p.quietHoursEnd)}</dd>
          ${p.disabledCategories.length ? `<dt>Disabled categories</dt><dd>${(p.disabledCategories as string[]).map(c => badge(c, 'yellow')).join(' ')}</dd>` : ''}
        </dl>`
      })() : '<p style="color:#64748b">Not yet created — user has not been shown consent prompt</p>'}
    </div>

    <h2 style="font-size:1rem;font-weight:600;margin-bottom:1rem">Bank connections</h2>
    ${connHtml}

    <div class="card">
      <div class="card-title">Message conversation (last 100)</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Role</th><th>Content</th><th>Intent</th><th>Time</th></tr></thead>
          <tbody>${convRows || '<tr><td colspan="4">No messages yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Onboarding tokens (last 10)</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Purpose</th><th>Status</th><th>Expires</th><th>Used at</th><th>Created</th></tr></thead>
          <tbody>${tokenRows || '<tr><td colspan="5">No tokens</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Audit log (last 50)</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Event</th><th>Data</th><th>Time</th></tr></thead>
          <tbody>${auditRows || '<tr><td colspan="4">No events</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `

  return layout(
    `User ${user.id.slice(0, 8)}…`,
    body,
    [
      { label: 'Dashboard', href: '/admin' },
      { label: 'Users', href: '/admin/users' },
      { label: user.id.slice(0, 8) + '…' },
    ],
  )
}
