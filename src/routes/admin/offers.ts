/**
 * Admin offer management routes.
 *
 * GET    /admin/offers           — paginated offer list (HTML)
 * POST   /admin/offers           — upsert an offer (JSON)
 * DELETE /admin/offers/:id       — soft-expire an offer (sets isActive=false)
 *
 * All routes are protected by the admin auth hook in admin/index.ts.
 * Mutations are logged to the audit log.
 */
import type { FastifyInstance } from 'fastify'
import { upsertOffer, type OfferInput } from '../../services/offers/offerUpsertService.js'
import { offersListPage } from './pages/offers.js'

interface UpsertOfferBody {
  providerName: string
  providerSlug: string
  categorySlug: string
  title: string
  shortDescription: string
  keyBenefits?: string[]
  keyTerms?: string[]
  parameters?: Record<string, unknown>
  affiliateNetwork: 'awin' | 'cj' | 'impact' | 'direct'
  affiliateProgramId: string
  affiliateBaseUrl: string
  commissionType: 'cpa' | 'cpl' | 'revenue_share'
  commissionValue: number
  targetMerchantSlugs?: string[]
  targetCategories?: string[]
  requiresBankLink?: boolean
  isRegulated?: boolean
  fcaDisclaimer?: string
  expiresAt?: string    // ISO date string
  startsAt?: string     // ISO date string
}

export async function registerAdminOfferRoutes(app: FastifyInstance): Promise<void> {
  // ── List ────────────────────────────────────────────────────────────────────
  app.get('/offers', async (request, reply) => {
    const html = await offersListPage(
      reply.server.prisma,
      request.query as Record<string, string>,
    )
    return reply.type('text/html').send(html)
  })

  // ── Upsert ──────────────────────────────────────────────────────────────────
  app.post<{ Body: UpsertOfferBody }>(
    '/offers',
    {
      schema: {
        body: {
          type: 'object',
          required: ['providerName', 'providerSlug', 'categorySlug', 'title', 'shortDescription',
                     'affiliateNetwork', 'affiliateProgramId', 'affiliateBaseUrl',
                     'commissionType', 'commissionValue'],
          properties: {
            providerName:       { type: 'string', minLength: 1 },
            providerSlug:       { type: 'string', minLength: 1 },
            categorySlug:       { type: 'string', minLength: 1 },
            title:              { type: 'string', minLength: 1 },
            shortDescription:   { type: 'string', minLength: 1 },
            keyBenefits:        { type: 'array', items: { type: 'string' } },
            keyTerms:           { type: 'array', items: { type: 'string' } },
            parameters:         { type: 'object' },
            affiliateNetwork:   { type: 'string', enum: ['awin', 'cj', 'impact', 'direct'] },
            affiliateProgramId: { type: 'string', minLength: 1 },
            affiliateBaseUrl:   { type: 'string', minLength: 1 },
            commissionType:     { type: 'string', enum: ['cpa', 'cpl', 'revenue_share'] },
            commissionValue:    { type: 'number', minimum: 0 },
            targetMerchantSlugs:{ type: 'array', items: { type: 'string' } },
            targetCategories:   { type: 'array', items: { type: 'string' } },
            requiresBankLink:   { type: 'boolean' },
            isRegulated:        { type: 'boolean' },
            fcaDisclaimer:      { type: 'string' },
            expiresAt:          { type: 'string' },
            startsAt:           { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body
      const prisma = reply.server.prisma

      const offerInput: OfferInput = {
        providerName:        body.providerName,
        providerSlug:        body.providerSlug,
        categorySlug:        body.categorySlug,
        title:               body.title,
        shortDescription:    body.shortDescription,
        keyBenefits:         body.keyBenefits ?? [],
        keyTerms:            body.keyTerms ?? [],
        parameters:          body.parameters ?? {},
        affiliateNetwork:    body.affiliateNetwork,
        affiliateProgramId:  body.affiliateProgramId,
        affiliateBaseUrl:    body.affiliateBaseUrl,
        commissionType:      body.commissionType,
        commissionValue:     body.commissionValue,
        targetMerchantSlugs: body.targetMerchantSlugs ?? [],
        targetCategories:    body.targetCategories ?? [],
        requiresBankLink:    body.requiresBankLink ?? false,
        isRegulated:         body.isRegulated ?? false,
        ...(body.fcaDisclaimer ? { fcaDisclaimer: body.fcaDisclaimer } : {}),
        ...(body.expiresAt     ? { expiresAt: new Date(body.expiresAt) } : {}),
        ...(body.startsAt      ? { startsAt:  new Date(body.startsAt)  } : {}),
      }

      const result = await upsertOffer(prisma, offerInput)

      return reply.status(result.action === 'created' ? 201 : 200).send({
        ok: true,
        action: result.action,
        offerId: result.id,
      })
    },
  )

  // ── Soft-expire ─────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/offers/:id',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const prisma = reply.server.prisma

      const existing = await prisma.offer.findUnique({ where: { id }, select: { id: true } })
      if (!existing) {
        return reply.status(404).send({ error: 'Offer not found' })
      }

      await prisma.offer.update({
        where: { id },
        data: { isActive: false, expiresAt: new Date() },
      })

      return reply.status(200).send({ ok: true })
    },
  )
}
