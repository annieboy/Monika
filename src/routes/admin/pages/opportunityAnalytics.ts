import type { PrismaClient } from '@prisma/client'
import { layout } from '../layout.js'

export async function opportunityAnalyticsPage(prisma: PrismaClient): Promise<string> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
  const sevenDaysAgo  = new Date(Date.now() -  7 * 86_400_000)

  const [
    totalDelivered,
    totalClicked,
    totalConverted,
    totalDismissed,
    recentDelivered,
    recentClicked,
    recentConverted,
    categoryStats,
    topOffers,
    commissionStats,
    pendingCommissions,
    recentRuns,
    revenueTrend,
  ] = await Promise.all([
    // All-time counts
    prisma.opportunity.count({ where: { status: { in: ['DELIVERED', 'CLICKED', 'CONVERTED', 'DISMISSED', 'EXPIRED'] } } }),
    prisma.opportunity.count({ where: { status: 'CLICKED' } }),
    prisma.opportunity.count({ where: { status: 'CONVERTED' } }),
    prisma.opportunity.count({ where: { status: 'DISMISSED' } }),

    // Last 7 days
    prisma.opportunity.count({ where: { deliveredAt: { gte: sevenDaysAgo } } }),
    prisma.opportunity.count({ where: { clickedAt: { gte: sevenDaysAgo } } }),
    prisma.opportunity.count({ where: { convertedAt: { gte: sevenDaysAgo } } }),

    // Per-category breakdown
    prisma.$queryRaw<{
      category: string
      delivered: number
      clicked: number
      converted: number
      dismissed: number
    }[]>`
      SELECT
        oc.name                                                              AS category,
        COUNT(*) FILTER (WHERE o.status IN ('DELIVERED','CLICKED','CONVERTED','DISMISSED','EXPIRED'))::int AS delivered,
        COUNT(*) FILTER (WHERE o.status = 'CLICKED')::int                  AS clicked,
        COUNT(*) FILTER (WHERE o.status = 'CONVERTED')::int                AS converted,
        COUNT(*) FILTER (WHERE o.status = 'DISMISSED')::int                AS dismissed
      FROM opportunities o
      JOIN offers of ON of.id = o.offer_id
      JOIN offer_categories oc ON oc.id = of.category_id
      GROUP BY oc.name, oc.sort_order
      ORDER BY oc.sort_order
    `,

    // Top performing offers (by conversion)
    prisma.$queryRaw<{
      providerName: string
      title: string
      delivered: number
      clicked: number
      converted: number
    }[]>`
      SELECT
        of.provider_name                                                     AS "providerName",
        of.title,
        COUNT(*) FILTER (WHERE o.status IN ('DELIVERED','CLICKED','CONVERTED','DISMISSED','EXPIRED'))::int AS delivered,
        COUNT(*) FILTER (WHERE o.status = 'CLICKED')::int                  AS clicked,
        COUNT(*) FILTER (WHERE o.status = 'CONVERTED')::int                AS converted
      FROM opportunities o
      JOIN offers of ON of.id = o.offer_id
      WHERE o.delivered_at >= ${thirtyDaysAgo}
      GROUP BY of.id, of.provider_name, of.title
      HAVING COUNT(*) FILTER (WHERE o.status IN ('DELIVERED','CLICKED','CONVERTED','DISMISSED','EXPIRED')) > 0
      ORDER BY converted DESC, clicked DESC
      LIMIT 10
    `,

    // Commission revenue
    prisma.affiliateClick.aggregate({
      where: { commissionStatus: { in: ['APPROVED', 'PAID'] } },
      _sum: { commissionAmount: true },
      _count: { _all: true },
    }),

    // Pending commissions
    prisma.affiliateClick.count({
      where: { commissionStatus: { in: ['PENDING', 'VALIDATED'] } },
    }),

    // Recent ingestion runs
    prisma.offerIngestionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5,
    }),

    // Daily revenue trend (last 30 days)
    prisma.$queryRaw<{ day: string; revenue: string }[]>`
      SELECT
        DATE(commission_locked_at)::text AS day,
        SUM(commission_amount)::text     AS revenue
      FROM affiliate_clicks
      WHERE commission_status IN ('APPROVED', 'PAID')
        AND commission_locked_at >= ${thirtyDaysAgo}
      GROUP BY DATE(commission_locked_at)
      ORDER BY DATE(commission_locked_at)
    `,
  ])

  const pct = (n: number, d: number) => d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fmt = (n: any) => n == null ? '—' : `£${Number(n).toFixed(2)}`

  const categoryRows = (categoryStats as {
    category: string; delivered: number; clicked: number; converted: number; dismissed: number
  }[]).map(c => `
    <tr>
      <td>${escHtml(c.category)}</td>
      <td>${c.delivered}</td>
      <td>${c.clicked} <span class="muted">(${pct(c.clicked, c.delivered)})</span></td>
      <td>${c.converted} <span class="muted">(${pct(c.converted, c.delivered)})</span></td>
      <td>${c.dismissed} <span class="muted">(${pct(c.dismissed, c.delivered)})</span></td>
    </tr>`).join('')

  const offerRows = (topOffers as {
    providerName: string; title: string; delivered: number; clicked: number; converted: number
  }[]).map(o => `
    <tr>
      <td>${escHtml(o.providerName)}</td>
      <td>${escHtml(o.title)}</td>
      <td>${o.delivered}</td>
      <td>${o.clicked} <span class="muted">(${pct(o.clicked, o.delivered)})</span></td>
      <td>${o.converted} <span class="muted">(${pct(o.converted, o.delivered)})</span></td>
    </tr>`).join('')

  const trendRows = (revenueTrend as { day: string; revenue: string }[]).map(r => `
    <tr>
      <td>${escHtml(r.day)}</td>
      <td>${fmt(r.revenue)}</td>
    </tr>`).join('')

  const runRows = recentRuns.map(r => `
    <tr>
      <td>${escHtml(r.source)}</td>
      <td><span class="badge ${r.status === 'completed' ? 'badge-green' : 'badge-grey'}">${escHtml(r.status)}</span></td>
      <td>+${r.offersCreated} / ↑${r.offersUpdated} / ×${r.offersExpired}</td>
      <td>${r.startedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
    </tr>`).join('')

  const content = `
    <h1>Opportunity Engine Analytics</h1>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Delivered (all-time)</div>
        <div class="stat-value">${totalDelivered.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Clicked (CTR)</div>
        <div class="stat-value">${totalClicked.toLocaleString()} <span class="stat-sub">${pct(totalClicked, totalDelivered)}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Converted (CVR)</div>
        <div class="stat-value">${totalConverted.toLocaleString()} <span class="stat-sub">${pct(totalConverted, totalDelivered)}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Dismissed</div>
        <div class="stat-value">${totalDismissed.toLocaleString()} <span class="stat-sub">${pct(totalDismissed, totalDelivered)}</span></div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Last 7 days — Delivered</div>
        <div class="stat-value">${recentDelivered}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last 7 days — Clicked</div>
        <div class="stat-value">${recentClicked} <span class="stat-sub">${pct(recentClicked, recentDelivered)}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last 7 days — Converted</div>
        <div class="stat-value">${recentConverted}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Commission Revenue (approved)</div>
        <div class="stat-value">${fmt(commissionStats._sum.commissionAmount)} <span class="stat-sub">${commissionStats._count._all} clicks</span></div>
      </div>
    </div>

    <h2>By Category (all-time)</h2>
    <table class="data-table">
      <thead><tr><th>Category</th><th>Delivered</th><th>Clicked</th><th>Converted</th><th>Dismissed</th></tr></thead>
      <tbody>${categoryRows || '<tr><td colspan="5" class="muted">No data yet</td></tr>'}</tbody>
    </table>

    <h2>Top Offers (last 30 days)</h2>
    <table class="data-table">
      <thead><tr><th>Provider</th><th>Title</th><th>Delivered</th><th>Clicked</th><th>Converted</th></tr></thead>
      <tbody>${offerRows || '<tr><td colspan="5" class="muted">No data yet</td></tr>'}</tbody>
    </table>

    <h2>Revenue Trend (last 30 days)</h2>
    <table class="data-table">
      <thead><tr><th>Date</th><th>Approved Revenue</th></tr></thead>
      <tbody>${trendRows || '<tr><td colspan="2" class="muted">No approved commissions yet</td></tr>'}</tbody>
    </table>

    <h2>Commission Reconciliation</h2>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Pending commissions</div>
        <div class="stat-value">${pendingCommissions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Approved revenue</div>
        <div class="stat-value">${fmt(commissionStats._sum.commissionAmount)}</div>
      </div>
    </div>

    <h2>Offer Ingestion Runs</h2>
    <table class="data-table">
      <thead><tr><th>Source</th><th>Status</th><th>Created / Updated / Expired</th><th>Started</th></tr></thead>
      <tbody>${runRows || '<tr><td colspan="4" class="muted">No ingestion runs yet</td></tr>'}</tbody>
    </table>
  `

  return layout('Opportunity Analytics', content)
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
