import type { PrismaClient } from '@prisma/client'
import { layout, esc, fmtAmount, badge, rowLink, paginate } from '../layout.js'

const PAGE_SIZE = 50

export async function transactionsListPage(
  prisma: PrismaClient,
  query: Record<string, string>,
): Promise<string> {
  const page = Math.max(1, Number(query['page'] ?? 1))
  const userId = query['userId'] ?? ''
  const accountId = query['accountId'] ?? ''
  const category = query['category'] ?? ''

  const where = {
    ...(userId ? { userId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(category ? { category } : {}),
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        account: { select: { displayName: true } },
        user: { select: { whatsappPhoneHash: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ])

  const baseUrl =
    '/admin/transactions' +
    (userId ? `?userId=${encodeURIComponent(userId)}` : '') +
    (accountId ? `${userId ? '&' : '?'}accountId=${encodeURIComponent(accountId)}` : '')

  const rows = transactions
    .map((t) => {
      const amtClass = Number(t.amount) < 0 ? 'amount-debit' : 'amount-credit'
      const catBadge = t.category ? badge(t.category, 'blue') : '<span style="color:#94a3b8">—</span>'
      return `<tr>
        <td>${rowLink(`/admin/transactions/${t.id}`, t.transactionDate.toISOString().slice(0, 10))}</td>
        <td>${esc(t.merchantName ?? t.rawDescription ?? '—')}</td>
        <td><span class="${amtClass}">${Number(t.amount) < 0 ? '' : '+'}£${Math.abs(Number(t.amount)).toFixed(2)}</span></td>
        <td>${catBadge}</td>
        <td>${esc(t.account?.displayName ?? '—')}</td>
        <td>${badge(t.transactionType, t.transactionType === 'credit' ? 'green' : 'gray')}</td>
        <td>${t.isRecurring ? badge('recurring', 'purple') : ''}</td>
      </tr>`
    })
    .join('')

  const filterHtml = userId
    ? `<div class="alert alert-info">Filtered by user <span class="mono">${esc(userId.slice(0, 8))}…</span>${accountId ? ` · account <span class="mono">${esc(accountId.slice(0, 8))}…</span>` : ''}</div>`
    : ''

  const body = `
    ${filterHtml}
    <div class="card">
      <div class="card-title">Transactions (${total})</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Merchant</th><th>Amount</th>
              <th>Category</th><th>Account</th><th>Type</th><th>Flags</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7">No transactions found</td></tr>'}</tbody>
        </table>
      </div>
      ${paginate(total, page, PAGE_SIZE, baseUrl)}
    </div>
  `

  return layout(
    'Transactions',
    body,
    [{ label: 'Dashboard', href: '/admin' }, { label: 'Transactions' }],
  )
}

export async function transactionDetailPage(
  prisma: PrismaClient,
  txnId: string,
): Promise<string | null> {
  const t = await prisma.transaction.findUnique({
    where: { id: txnId },
    include: {
      account: { select: { displayName: true, accountType: true } },
      user: { select: { id: true, whatsappPhoneHash: true } },
    },
  })

  if (!t) return null

  const amountHtml = fmtAmount(t.amount, t.transactionType)

  const body = `
    <div class="card">
      <div class="card-title">Transaction details</div>
      <dl class="detail-grid">
        <dt>ID</dt><dd><span class="mono">${esc(t.id)}</span></dd>
        <dt>Date</dt><dd>${esc(t.transactionDate.toISOString().slice(0, 10))}</dd>
        <dt>Amount</dt><dd>${amountHtml}</dd>
        <dt>Currency</dt><dd>${esc(t.currency)}</dd>
        <dt>Type</dt><dd>${badge(t.transactionType, t.transactionType === 'credit' ? 'green' : 'gray')}</dd>
        <dt>Status</dt><dd>${badge(t.status, t.status === 'settled' ? 'green' : 'yellow')}</dd>
        <dt>Merchant</dt><dd>${esc(t.merchantName ?? '—')}</dd>
        <dt>Merchant (clean)</dt><dd>${esc(t.merchantNameClean ?? '—')}</dd>
        <dt>Raw description</dt><dd>${esc(t.rawDescription ?? '—')}</dd>
        <dt>Category</dt><dd>${t.category ? badge(t.category, 'blue') : '—'}</dd>
        <dt>Subcategory</dt><dd>${esc(t.subcategory ?? '—')}</dd>
        <dt>Category method</dt><dd>${t.categoryMethod ? badge(t.categoryMethod, 'gray') : '—'}</dd>
        <dt>Is recurring</dt><dd>${t.isRecurring ? badge('yes', 'purple') : badge('no', 'gray')}</dd>
        <dt>Subscription name</dt><dd>${esc(t.subscriptionName ?? '—')}</dd>
        <dt>Account</dt><dd>${esc(t.account?.displayName ?? '—')} (${esc(t.account?.accountType ?? '')})</dd>
        <dt>User</dt><dd>${rowLink(`/admin/users/${t.user.id}`, t.user.id.slice(0, 8) + '…')}</dd>
        <dt>Provider txn ID</dt><dd><span class="mono">${esc(t.providerTransactionId)}</span></dd>
        <dt>Dedup hash</dt><dd><span class="mono">${esc(t.dedupHash ?? '—')}</span></dd>
      </dl>
    </div>

    ${
      t.providerRawData
        ? `<div class="card">
          <div class="card-title">Provider raw data</div>
          <pre class="json">${esc(JSON.stringify(t.providerRawData, null, 2))}</pre>
        </div>`
        : ''
    }
  `

  return layout(
    `Transaction ${t.id.slice(0, 8)}…`,
    body,
    [
      { label: 'Dashboard', href: '/admin' },
      { label: 'Transactions', href: `/admin/transactions?userId=${t.user.id}` },
      { label: t.id.slice(0, 8) + '…' },
    ],
  )
}
