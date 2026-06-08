/**
 * User self-service routes — GDPR rights endpoints.
 *
 * POST /users/delete  — Right to Erasure (Article 17)
 * GET  /users/export  — Right of Access (Article 15)
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
}

export default userRoutes
