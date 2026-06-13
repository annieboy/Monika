/**
 * User self-service routes — GDPR rights endpoints + opportunity history.
 *
 * POST /users/delete           — Right to Erasure (Article 17)
 * GET  /users/export           — Right of Access (Article 15)
 * GET  /users/me/opportunities — Opportunity history for a user
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { deleteUser, exportUserData } from '../../services/users/deletion.js'

interface UserBody {
  userId: string
}

const userRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ── POST /users/delete ─────────────────────────────────────────────────
  app.post<{ Body: UserBody }>(
    '/delete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              connectionsRevoked: { type: 'number' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: UserBody }>,
      reply: FastifyReply,
    ) => {
      const { userId } = request.body
      const prisma = request.server.prisma

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, deletedAt: true },
      })

      if (!user) return reply.status(404).send({ error: 'User not found' })
      if (user.deletedAt) return reply.status(409).send({ error: 'User already deleted' })

      const result = await deleteUser(prisma, userId)

      request.log.info({ userId, ...result }, 'User data deleted (GDPR erasure)')

      return reply.status(200).send({
        message: 'Your data has been deleted. Bank connections have been revoked.',
        connectionsRevoked: result.connectionsRevoked,
      })
    },
  )

  // ── GET /users/export ──────────────────────────────────────────────────
  app.get<{ Querystring: UserBody }>(
    '/export',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: UserBody }>,
      reply: FastifyReply,
    ) => {
      const { userId } = request.query
      const prisma = request.server.prisma

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, deletedAt: true },
      })

      if (!user) return reply.status(404).send({ error: 'User not found' })
      if (user.deletedAt) return reply.status(410).send({ error: 'User data has been deleted' })

      const data = await exportUserData(prisma, userId)

      return reply
        .header('Content-Disposition', `attachment; filename="monika-data-export-${userId.slice(0, 8)}.json"`)
        .header('Content-Type', 'application/json')
        .status(200)
        .send(data)
    },
  )

  // ── GET /users/me/preferences ─────────────────────────────────────────────
  app.get<{ Querystring: { userId: string } }>(
    '/me/preferences',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.query
      const prisma = request.server.prisma

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } })
      if (!user) return reply.status(404).send({ error: 'User not found' })
      if (user.deletedAt) return reply.status(410).send({ error: 'User data has been deleted' })

      const prefs = await prisma.userOpportunityPreferences.findUnique({ where: { userId } })

      return reply.status(200).send({
        opportunitiesConsent:  prefs?.opportunitiesConsent ?? false,
        maxMessagesPerWeek:    prefs?.maxMessagesPerWeek   ?? 2,
        maxMessagesPerMonth:   prefs?.maxMessagesPerMonth  ?? 6,
        quietHoursStart:       prefs?.quietHoursStart      ?? '21:00',
        quietHoursEnd:         prefs?.quietHoursEnd        ?? '08:00',
        disabledCategories:    prefs?.disabledCategories   ?? [],
        consentGivenAt:        prefs?.consentGivenAt       ?? null,
        consentWithdrawnAt:    prefs?.consentWithdrawnAt   ?? null,
      })
    },
  )

  // ── PATCH /users/me/preferences ───────────────────────────────────────────
  app.patch<{
    Querystring: { userId: string }
    Body: {
      opportunitiesConsent?: boolean
      maxMessagesPerWeek?: number
      maxMessagesPerMonth?: number
      quietHoursStart?: string
      quietHoursEnd?: string
      disabledCategories?: string[]
    }
  }>(
    '/me/preferences',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            opportunitiesConsent: { type: 'boolean' },
            maxMessagesPerWeek:   { type: 'integer', minimum: 0, maximum: 7 },
            maxMessagesPerMonth:  { type: 'integer', minimum: 0, maximum: 31 },
            quietHoursStart:      { type: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$' },
            quietHoursEnd:        { type: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$' },
            disabledCategories:   { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.query
      const prisma = request.server.prisma
      const body = request.body

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } })
      if (!user) return reply.status(404).send({ error: 'User not found' })
      if (user.deletedAt) return reply.status(410).send({ error: 'User data has been deleted' })

      // Determine consent transition timestamps
      const current = await prisma.userOpportunityPreferences.findUnique({ where: { userId } })
      const consentTransition: Record<string, unknown> = {}
      if (body.opportunitiesConsent === true && !current?.opportunitiesConsent) {
        consentTransition['consentGivenAt'] = new Date()
        consentTransition['consentMethod'] = 'api'
        consentTransition['consentWithdrawnAt'] = null
      } else if (body.opportunitiesConsent === false && current?.opportunitiesConsent) {
        consentTransition['consentWithdrawnAt'] = new Date()
      }

      const updateData = {
        ...(body.opportunitiesConsent !== undefined ? { opportunitiesConsent: body.opportunitiesConsent } : {}),
        ...(body.maxMessagesPerWeek   !== undefined ? { maxMessagesPerWeek:   body.maxMessagesPerWeek   } : {}),
        ...(body.maxMessagesPerMonth  !== undefined ? { maxMessagesPerMonth:  body.maxMessagesPerMonth  } : {}),
        ...(body.quietHoursStart      !== undefined ? { quietHoursStart:      body.quietHoursStart      } : {}),
        ...(body.quietHoursEnd        !== undefined ? { quietHoursEnd:        body.quietHoursEnd        } : {}),
        ...(body.disabledCategories   !== undefined ? { disabledCategories:   body.disabledCategories   } : {}),
        ...consentTransition,
      }

      const updated = await prisma.userOpportunityPreferences.upsert({
        where: { userId },
        create: { userId, ...updateData },
        update: updateData,
      })

      return reply.status(200).send({
        opportunitiesConsent:  updated.opportunitiesConsent,
        maxMessagesPerWeek:    updated.maxMessagesPerWeek,
        maxMessagesPerMonth:   updated.maxMessagesPerMonth,
        quietHoursStart:       updated.quietHoursStart,
        quietHoursEnd:         updated.quietHoursEnd,
        disabledCategories:    updated.disabledCategories,
        consentGivenAt:        updated.consentGivenAt,
        consentWithdrawnAt:    updated.consentWithdrawnAt,
      })
    },
  )

  // ── GET /users/me/opportunities ───────────────────────────────────────────
  app.get<{ Querystring: { userId: string; limit?: string; offset?: string } }>(
    '/me/opportunities',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            limit:  { type: 'string' },
            offset: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId, limit: limitStr, offset: offsetStr } = request.query
      const prisma = request.server.prisma
      const limit  = Math.min(parseInt(limitStr  ?? '20', 10), 100)
      const offset = parseInt(offsetStr ?? '0', 10)

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, deletedAt: true },
      })

      if (!user) return reply.status(404).send({ error: 'User not found' })
      if (user.deletedAt) return reply.status(410).send({ error: 'User data has been deleted' })

      const [opportunities, total] = await Promise.all([
        prisma.opportunity.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            status: true,
            annualSavingEstimate: true,
            savingConfidence: true,
            createdAt: true,
            deliveredAt: true,
            expiresAt: true,
            offer: {
              select: {
                id: true,
                title: true,
                providerName: true,
                shortDescription: true,
                category: { select: { slug: true, name: true } },
              },
            },
          },
        }),
        prisma.opportunity.count({ where: { userId } }),
      ])

      return reply.status(200).send({
        total,
        limit,
        offset,
        items: opportunities.map(o => ({
          id: o.id,
          status: o.status,
          annualSavingEstimate: o.annualSavingEstimate ? Number(o.annualSavingEstimate) : null,
          savingConfidence: o.savingConfidence,
          createdAt: o.createdAt,
          deliveredAt: o.deliveredAt,
          expiresAt: o.expiresAt,
          offer: o.offer,
        })),
      })
    },
  )
}

export default userRoutes

