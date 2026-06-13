/**
 * Admin dashboard routes.
 *
 * All routes are protected by HTTP Basic Auth (requireAdminAuth).
 * Every response is read-only — no mutations, no deletes.
 * Sensitive fields (encrypted bytes, raw tokens) are never rendered.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { requireAdminAuth } from './auth.js'
import { dashboardPage } from './pages/dashboard.js'
import { usersListPage, userDetailPage } from './pages/users.js'
import { transactionsListPage, transactionDetailPage } from './pages/transactions.js'
import { auditLogPage } from './pages/audit.js'
import { analyticsPage } from './pages/analytics.js'
import { registerAdminOfferRoutes } from './offers.js'

const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ── Auth hook — runs before every /admin route ─────────────────────────────
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for the logout endpoint (it just clears auth state on the browser side)
    if (request.url === '/admin/logout') return
    const ok = requireAdminAuth(request, reply)
    if (!ok) {
      // requireAdminAuth has already sent the 401 — stop processing
      return reply
    }
  })

  // ── Dashboard ──────────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => {
    const html = await dashboardPage(reply.server.prisma)
    return reply.type('text/html').send(html)
  })

  // ── Logout ─────────────────────────────────────────────────────────────────
  // Clears Basic Auth by returning 401, which prompts the browser to discard
  // the cached credentials.
  app.get('/logout', async (_req, reply) => {
    return reply
      .status(401)
      .header('WWW-Authenticate', 'Basic realm="Monika Admin"')
      .type('text/html')
      .send('<p>Signed out. <a href="/admin">Sign in again</a></p>')
  })

  // ── Users list ─────────────────────────────────────────────────────────────
  app.get('/users', async (request, reply) => {
    const html = await usersListPage(
      reply.server.prisma,
      request.query as Record<string, string>,
    )
    return reply.type('text/html').send(html)
  })

  // ── User detail ────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const html = await userDetailPage(reply.server.prisma, request.params.id)
    if (!html) return reply.status(404).type('text/html').send('<h1>User not found</h1>')
    return reply.type('text/html').send(html)
  })

  // ── Transactions list ──────────────────────────────────────────────────────
  app.get('/transactions', async (request, reply) => {
    const html = await transactionsListPage(
      reply.server.prisma,
      request.query as Record<string, string>,
    )
    return reply.type('text/html').send(html)
  })

  // ── Transaction detail ─────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/transactions/:id', async (request, reply) => {
    const html = await transactionDetailPage(reply.server.prisma, request.params.id)
    if (!html) return reply.status(404).type('text/html').send('<h1>Transaction not found</h1>')
    return reply.type('text/html').send(html)
  })

  // ── Audit log ──────────────────────────────────────────────────────────────
  app.get('/audit', async (request, reply) => {
    const html = await auditLogPage(
      reply.server.prisma,
      request.query as Record<string, string>,
    )
    return reply.type('text/html').send(html)
  })

  // ── Product analytics ──────────────────────────────────────────────────────
  app.get('/analytics', async (_req, reply) => {
    const html = await analyticsPage(reply.server.prisma)
    return reply.type('text/html').send(html)
  })

  // ── Offer management ───────────────────────────────────────────────────────
  await registerAdminOfferRoutes(app)
}

export default adminRoutes
