import type { PrismaClient } from '@prisma/client'
import { layout } from '../layout.js'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function categoriesPage(prisma: PrismaClient): Promise<string> {
  const categories = await prisma.offerCategory.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { offers: { where: { isActive: true } } } } },
  })

  const rows = categories.map(c => `
    <tr>
      <td>${esc(c.iconEmoji ?? '')} ${esc(c.name)}</td>
      <td><code>${esc(c.slug)}</code></td>
      <td>${c._count.offers}</td>
      <td>${c.sortOrder}</td>
      <td><span class="badge ${c.isActive ? 'badge-green' : 'badge-grey'}">${c.isActive ? 'Active' : 'Inactive'}</span></td>
    </tr>`).join('')

  const content = `
    <h1>Offer Categories</h1>
    <p class="muted">${categories.length} categories · Seeded via <code>npm run db:seed</code></p>

    <table class="data-table">
      <thead>
        <tr>
          <th>Category</th>
          <th>Slug</th>
          <th>Active Offers</th>
          <th>Sort Order</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No categories yet — run <code>npm run db:seed</code></td></tr>'}</tbody>
    </table>
  `

  return layout('Offer Categories', content)
}
