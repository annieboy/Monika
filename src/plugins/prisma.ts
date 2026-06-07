/**
 * Fastify plugin: attaches the PrismaClient to the Fastify instance.
 *
 * Usage in routes:
 *   const user = await request.server.prisma.user.findUnique(...)
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'
import { prisma, connectDatabase } from '../lib/prisma.js'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

const prismaPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  await connectDatabase()

  app.decorate('prisma', prisma)

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(prismaPlugin, {
  name: 'prisma',
})
