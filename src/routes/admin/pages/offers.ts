import type { PrismaClient, AffiliateNetwork } from '@prisma/client'
import { layout } from '../layout.js'

export async function offersListPage(
  prisma: PrismaClient,
  query: Record<string, string>,
): Promise<string> {
  const page = Math.max(1, parseInt(query['page'] ?? '1', 10))
  const perPage = 25
  const skip = (page - 1) * perPage

  const categoryFilter = query['category'] ?? ''
  const networkFilter = query['network'] ?? ''
  const activeOnly = query['active'] !== 'false'

  const where = {
    ...(categoryFilter ? { category: { slug: categoryFilter } } : {}),
    ...(networkFilter ? { affiliateNetwork: networkFilter as AffiliateNetwork } : {}),
    ...(activeOnly ? { isActive: true } : {}),
  }

  const [offers, total, categories] = await Promise.all([
    prisma.offer.findMany({
      where,
      include: { category: { select: { slug: true, name: true } } },
      orderBy: [{ isActive: 'desc' }, { category: { sortOrder: 'asc' } }, { providerName: 'asc' }],
      skip,
      take: perPage,
    }),
    prisma.offer.count({ where }),
    prisma.offerCategory.findMany({ orderBy: { sortOrder: 'asc' }, select: { slug: true, name: true } }),
  ])

  const totalPages = Math.ceil(total / perPage)

  const categoryOptions = categories
    .map((c) => `<option value="${c.slug}" ${categoryFilter === c.slug ? 'selected' : ''}>${c.name}</option>`)
    .join('')

  const rows = offers.map((o) => {
    const cat = (o as typeof o & { category?: { name: string } | null }).category
    const commVal = Number(o.commissionValue)
    const commissionDisplay = o.commissionType === 'revenue_share'
      ? `${(commVal * 100).toFixed(0)}%`
      : `£${commVal}`
    return `
      <tr>
        <td><span class="badge ${o.isActive ? 'badge-green' : 'badge-grey'}">${o.isActive ? 'Active' : 'Inactive'}</span></td>
        <td>${escHtml(cat?.name ?? '—')}</td>
        <td><strong>${escHtml(o.providerName)}</strong><br><small>${escHtml(o.title)}</small></td>
        <td>${escHtml(o.affiliateNetwork)}</td>
        <td>${escHtml(commissionDisplay)}</td>
        <td>${o.requiresBankLink ? '✓' : '—'}</td>
        <td>
          ${o.isActive ? `<button class="btn-sm btn-danger" hx-delete="/admin/offers/${o.id}" hx-confirm="Expire this offer?" hx-target="closest tr" hx-swap="outerHTML">Expire</button>` : ''}
        </td>
      </tr>`
  }).join('')

  const pagination = totalPages > 1
    ? `<div class="pagination">
        ${page > 1 ? `<a href="?page=${page - 1}&category=${categoryFilter}&network=${networkFilter}&active=${activeOnly}">← Prev</a>` : ''}
        <span>Page ${page} of ${totalPages} (${total} offers)</span>
        ${page < totalPages ? `<a href="?page=${page + 1}&category=${categoryFilter}&network=${networkFilter}&active=${activeOnly}">Next →</a>` : ''}
       </div>`
    : `<p class="muted">${total} offer${total !== 1 ? 's' : ''}</p>`

  const content = `
    <div class="page-header">
      <h1>Offers</h1>
    </div>

    <form class="filter-bar" method="get">
      <select name="category"><option value="">All categories</option>${categoryOptions}</select>
      <select name="network">
        <option value="">All networks</option>
        ${['awin','cj','impact','direct'].map(n => `<option value="${n}" ${networkFilter===n?'selected':''}>${n}</option>`).join('')}
      </select>
      <label><input type="checkbox" name="active" value="true" ${activeOnly?'checked':''}> Active only</label>
      <button type="submit" class="btn-sm">Filter</button>
    </form>

    <table class="data-table">
      <thead><tr>
        <th>Status</th><th>Category</th><th>Provider / Title</th>
        <th>Network</th><th>Commission</th><th>Bank req.</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No offers found</td></tr>'}</tbody>
    </table>
    ${pagination}
  `

  return layout('Offers', content)
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
