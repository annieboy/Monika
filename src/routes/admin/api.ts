/**
 * Admin JSON REST API.
 *
 * All routes require the same HTTP Basic Auth as the HTML dashboard.
 * Responses are always JSON (no HTML).
 *
 * GET  /admin/api/offers              — paginated offer list
 * GET  /admin/api/offers/:id          — single offer
 * GET  /admin/api/ingestion-runs      — paginated ingestion run history
 * GET  /admin/api/opportunities/stats — opportunity engine summary stats
 * POST /admin/api/jobs/trigger        — manually enqueue a BullMQ job
 */
import type { FastifyInstance } from 'fastify'
import { getOpportunityQueue } from '../../queues/opportunityQueue.js'
import type { OpportunityJobName } from '../../queues/opportunityQueue.js'

const VALID_JOB_NAMES: ReadonlySet<string> = new Set<OpportunityJobName>([
  'detect-opportunities',
  'deliver-opportunities',
  'bill-reminders',
  'expire-offers',
  'reconcile-commissions',
  'goal-progress-check',
  'weekly-digest',
  'expiry-nudge',
])

export async function registerAdminApiRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /admin/api/offers ────────────────────────────────────────────────
  app.get('/api/offers', async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q['page'] ?? '1', 10))
    const perPage = Math.min(100, Math.max(1, parseInt(q['perPage'] ?? '20', 10)))
    const skip = (page - 1) * perPage
    const activeOnly = q['active'] !== 'false'
    const categorySlug = q['category']

    const where = {
      ...(activeOnly ? { isActive: true } : {}),
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    }

    const [total, offers] = await Promise.all([
      reply.server.prisma.offer.count({ where }),
      reply.server.prisma.offer.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          providerName: true,
          providerSlug: true,
          title: true,
          shortDescription: true,
          affiliateNetwork: true,
          commissionType: true,
          commissionValue: true,
          isActive: true,
          requiresBankLink: true,
          isRegulated: true,
          startsAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { name: true, slug: true } },
        },
      }),
    ])

    return reply.send({
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      offers,
    })
  })

  // ── GET /admin/api/offers/:id ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/offers/:id', async (request, reply) => {
    const offer = await reply.server.prisma.offer.findUnique({
      where: { id: request.params.id },
      include: { category: true },
    })
    if (!offer) return reply.status(404).send({ error: 'Offer not found' })
    return reply.send(offer)
  })

  // ── GET /admin/api/ingestion-runs ────────────────────────────────────────
  app.get('/api/ingestion-runs', async (request, reply) => {
    const q = request.query as Record<string, string>
    const page = Math.max(1, parseInt(q['page'] ?? '1', 10))
    const perPage = Math.min(100, Math.max(1, parseInt(q['perPage'] ?? '20', 10)))
    const skip = (page - 1) * perPage
    const source = q['source']
    const status = q['status']

    const where = {
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
    }

    const [total, runs] = await Promise.all([
      reply.server.prisma.offerIngestionRun.count({ where }),
      reply.server.prisma.offerIngestionRun.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { startedAt: 'desc' },
      }),
    ])

    return reply.send({
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      runs,
    })
  })

  // ── GET /admin/api/opportunities/stats ───────────────────────────────────
  app.get('/api/opportunities/stats', async (_request, reply) => {
    const prisma = reply.server.prisma
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

    const [
      totalDelivered,
      totalClicked,
      totalConverted,
      totalDismissed,
      recentDelivered,
      recentClicked,
      recentConverted,
      commissionStats,
      pendingCommissions,
      lastRun,
    ] = await Promise.all([
      prisma.opportunity.count({ where: { status: { in: ['DELIVERED', 'CLICKED', 'CONVERTED', 'DISMISSED', 'EXPIRED'] } } }),
      prisma.opportunity.count({ where: { status: 'CLICKED' } }),
      prisma.opportunity.count({ where: { status: 'CONVERTED' } }),
      prisma.opportunity.count({ where: { status: 'DISMISSED' } }),
      prisma.opportunity.count({ where: { deliveredAt: { gte: sevenDaysAgo } } }),
      prisma.opportunity.count({ where: { clickedAt: { gte: sevenDaysAgo } } }),
      prisma.opportunity.count({ where: { convertedAt: { gte: sevenDaysAgo } } }),
      prisma.affiliateClick.aggregate({
        where: { commissionStatus: { in: ['APPROVED', 'PAID'] } },
        _sum: { commissionAmount: true },
        _count: { _all: true },
      }),
      prisma.affiliateClick.count({ where: { commissionStatus: { in: ['PENDING', 'VALIDATED'] } } }),
      prisma.offerIngestionRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ])

    return reply.send({
      allTime: {
        delivered: totalDelivered,
        clicked: totalClicked,
        converted: totalConverted,
        dismissed: totalDismissed,
        ctr: totalDelivered > 0 ? +(totalClicked / totalDelivered * 100).toFixed(2) : 0,
        cvr: totalDelivered > 0 ? +(totalConverted / totalDelivered * 100).toFixed(2) : 0,
      },
      last7Days: {
        delivered: recentDelivered,
        clicked: recentClicked,
        converted: recentConverted,
      },
      commissions: {
        approvedCount: commissionStats._count._all,
        approvedRevenue: commissionStats._sum.commissionAmount ?? 0,
        pendingCount: pendingCommissions,
      },
      lastIngestionRun: lastRun ?? null,
    })
  })

  // ── POST /admin/api/jobs/trigger ─────────────────────────────────────────
  app.post<{ Body: { job: string; userId?: string } }>(
    '/api/jobs/trigger',
    {
      schema: {
        body: {
          type: 'object',
          required: ['job'],
          properties: {
            job: { type: 'string' },
            userId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { job, userId } = request.body

      if (!VALID_JOB_NAMES.has(job)) {
        return reply.status(400).send({
          error: `Unknown job. Valid values: ${[...VALID_JOB_NAMES].join(', ')}`,
        })
      }

      const queue = getOpportunityQueue()
      const added = await queue.add(
        job as OpportunityJobName,
        userId ? { userId } : {},
        { priority: 1 },
      )

      return reply.status(202).send({ ok: true, jobId: added.id, name: job })
    },
  )
}
