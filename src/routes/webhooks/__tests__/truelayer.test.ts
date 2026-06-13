import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'
import { createHmac } from 'crypto'

vi.mock('../../../config.js', () => ({
  config: {
    TRUELAYER_WEBHOOK_SECRET: '',
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
  },
}))

vi.mock('../../../services/opportunity/opportunityDetector.js', () => ({
  detectOpportunities: vi.fn().mockResolvedValue(3),
}))

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
vi.mock('../../../queues/opportunityQueue.js', () => ({
  getOpportunityQueue: () => ({ add: mockQueueAdd }),
}))

import truelayerRoutes from '../truelayer.js'
import { config } from '../../../config.js'
import { detectOpportunities } from '../../../services/opportunity/opportunityDetector.js'

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function makePrisma(): PrismaClient {
  return {
    bankConnection: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaClient
}

async function buildTestApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fp(async (a) => { a.decorate('prisma', prisma) }))
  await app.register(truelayerRoutes, { prefix: '/webhooks' })
  return app
}

describe('POST /webhooks/truelayer', () => {
  let app: FastifyInstance
  let prisma: PrismaClient

  beforeEach(async () => {
    vi.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(config as any).TRUELAYER_WEBHOOK_SECRET = ''
    prisma = makePrisma()
    app = await buildTestApp(prisma)
  })

  it('returns 200 for a valid event when no secret configured', async () => {
    const body = JSON.stringify({
      type: 'transaction_created',
      event_id: 'evt-1',
      timestamp: new Date().toISOString(),
      payload: { user_id: '00000000-0000-0000-0000-000000000001' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(res.statusCode).toBe(200)
  })

  it('calls detectOpportunities for transaction_created', async () => {
    const body = JSON.stringify({
      type: 'transaction_created',
      event_id: 'evt-1',
      timestamp: new Date().toISOString(),
      payload: { user_id: 'user-abc' },
    })

    await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(detectOpportunities).toHaveBeenCalledWith(expect.anything(), 'user-abc')
  })

  it('marks connection revoked for consent_revoked event', async () => {
    const body = JSON.stringify({
      type: 'consent_revoked',
      event_id: 'evt-2',
      timestamp: new Date().toISOString(),
      payload: { consent_id: 'consent-xyz' },
    })

    await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: { providerConsentId: 'consent-xyz' },
      data: { consentStatus: 'revoked' },
    })
  })

  it('marks connection expired for token_expired event', async () => {
    const body = JSON.stringify({
      type: 'token_expired',
      event_id: 'evt-3',
      timestamp: new Date().toISOString(),
      payload: { consent_id: 'consent-abc' },
    })

    await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: { providerConsentId: 'consent-abc' },
      data: { consentStatus: 'expired' },
    })
  })

  it('returns 200 for unknown event type without throwing', async () => {
    const body = JSON.stringify({
      type: 'some_future_event',
      event_id: 'evt-4',
      timestamp: new Date().toISOString(),
      payload: {},
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(res.statusCode).toBe(200)
    expect(detectOpportunities).not.toHaveBeenCalled()
  })

  it('returns 401 when signature invalid and secret is configured', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(config as any).TRUELAYER_WEBHOOK_SECRET = 'my-webhook-secret'

    const body = JSON.stringify({
      type: 'transaction_created',
      event_id: 'evt-5',
      timestamp: new Date().toISOString(),
      payload: { user_id: 'user-abc' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json', 'tl-signature': 'invalid-sig' },
      body,
    })

    expect(res.statusCode).toBe(401)
    expect(detectOpportunities).not.toHaveBeenCalled()
  })

  it('accepts valid HMAC signature when secret is configured', async () => {
    const secret = 'my-webhook-secret'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(config as any).TRUELAYER_WEBHOOK_SECRET = secret

    const payload = {
      type: 'transaction_created',
      event_id: 'evt-6',
      timestamp: new Date().toISOString(),
      payload: { user_id: 'user-abc' },
    }
    const body = JSON.stringify(payload)
    const sig = sign(body, secret)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json', 'tl-signature': sig },
      body,
    })

    expect(res.statusCode).toBe(200)
    expect(detectOpportunities).toHaveBeenCalled()
  })

  it('enqueues deliver-opportunities when transaction_created detects opportunities', async () => {
    const body = JSON.stringify({
      type: 'transaction_created',
      event_id: 'evt-8',
      timestamp: new Date().toISOString(),
      payload: { user_id: 'user-deliver-test' },
    })

    await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    // Allow async queue add to settle
    await new Promise((r) => setTimeout(r, 10))

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'deliver-opportunities',
      { userId: 'user-deliver-test' },
      expect.objectContaining({ priority: 1 }),
    )
  })

  it('does not enqueue delivery when no opportunities detected', async () => {
    vi.mocked(detectOpportunities).mockResolvedValueOnce(0)

    const body = JSON.stringify({
      type: 'transaction_created',
      event_id: 'evt-9',
      timestamp: new Date().toISOString(),
      payload: { user_id: 'user-no-opps' },
    })

    await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('gracefully handles transaction_created with missing user_id', async () => {
    const body = JSON.stringify({
      type: 'transaction_created',
      event_id: 'evt-7',
      timestamp: new Date().toISOString(),
      payload: {},
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/truelayer',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(res.statusCode).toBe(200)
    expect(detectOpportunities).not.toHaveBeenCalled()
  })
})
