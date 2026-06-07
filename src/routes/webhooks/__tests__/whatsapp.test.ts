import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { PrismaClient } from '@prisma/client'
import whatsappRoutes from '../whatsapp.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const APP_SECRET = 'test-app-secret'
const VERIFY_TOKEN = 'test-verify-token'

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')
}

function makePayload(overrides: Record<string, unknown> = {}): string {
  const base = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '447700900000', phone_number_id: 'waba-123' },
              messages: [
                {
                  id: 'wamid.test123',
                  from: '447700900001',
                  timestamp: '1717776000',
                  type: 'text',
                  text: { body: 'Hello Monika' },
                },
              ],
            },
          },
        ],
      },
    ],
  }
  return JSON.stringify({ ...base, ...overrides })
}

// ── Mock Prisma ────────────────────────────────────────────────────────────

function makeMockPrisma(): PrismaClient {
  const now = new Date()
  return {
    user: {
      upsert: vi.fn().mockResolvedValue({
        id: 'user-uuid',
        createdAt: now,
        updatedAt: now,
      }),
    },
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'conv-uuid' }),
    },
  } as unknown as PrismaClient
}

function makePrismaPlugin(prisma: PrismaClient) {
  return fp(async (app: FastifyInstance) => {
    app.decorate('prisma', prisma)
  })
}

async function buildTestApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(makePrismaPlugin(prisma))
  await app.register(whatsappRoutes, { prefix: '/webhooks' })
  return app
}

// ── GET /webhooks/whatsapp — webhook verification ──────────────────────────

describe('GET /webhooks/whatsapp', () => {
  it('returns hub.challenge when mode and token are valid', async () => {
    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

    const res = await app.inject({
      method: 'GET',
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=ping123`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('ping123')
  })

  it('returns 403 when verify_token is wrong', async () => {
    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=ping',
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 400 when mode is not subscribe', async () => {
    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

    const res = await app.inject({
      method: 'GET',
      url: `/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=ping`,
    })

    expect(res.statusCode).toBe(400)
  })
})

// ── POST /webhooks/whatsapp — inbound messages ─────────────────────────────

describe('POST /webhooks/whatsapp', () => {
  let prisma: PrismaClient
  let app: FastifyInstance

  beforeEach(async () => {
    vi.resetAllMocks()
    prisma = makeMockPrisma()
    app = await buildTestApp(prisma)
  })

  it('stores a valid text message and returns 200', async () => {
    const body = makePayload()
    const sig = sign(body, APP_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' })
    expect(prisma.conversation.create).toHaveBeenCalledOnce()
    expect(prisma.user.upsert).toHaveBeenCalledOnce()
  })

  it('returns 403 when signature header is missing', async () => {
    const body = makePayload()

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(res.statusCode).toBe(403)
    expect(prisma.conversation.create).not.toHaveBeenCalled()
  })

  it('returns 403 when signature is invalid', async () => {
    const body = makePayload()

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      body,
    })

    expect(res.statusCode).toBe(403)
    expect(prisma.conversation.create).not.toHaveBeenCalled()
  })

  it('returns 200 without storing when message is a duplicate', async () => {
    const existingConv = { id: 'existing-conv', userId: 'user-uuid' }
    ;(prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existingConv)

    const body = makePayload()
    const sig = sign(body, APP_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.statusCode).toBe(200)
    expect(prisma.conversation.create).not.toHaveBeenCalled()
  })

  it('returns 200 without storing when payload has no text messages', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '447700900000', phone_number_id: 'waba-123' },
                statuses: [{ id: 'wamid.status', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    })
    const sig = sign(body, APP_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.statusCode).toBe(200)
    expect(prisma.conversation.create).not.toHaveBeenCalled()
  })

  it('returns 200 without storing for a non-text message type (image)', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '447700900000', phone_number_id: 'waba-123' },
                messages: [
                  {
                    id: 'wamid.image1',
                    from: '447700900001',
                    timestamp: '1717776000',
                    type: 'image',
                    image: { id: 'img-id', mime_type: 'image/jpeg' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    const sig = sign(body, APP_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.statusCode).toBe(200)
    expect(prisma.conversation.create).not.toHaveBeenCalled()
  })

  it('hashes the phone number — upsert uses hash, not raw phone', async () => {
    const body = makePayload()
    const sig = sign(body, APP_SECRET)

    await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    const upsertCall = (prisma.user.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { where: { whatsappPhoneHash: string }; create: { whatsappPhoneHash: string } },
    ]
    const hash = upsertCall[0].where.whatsappPhoneHash
    // Must be a 64-char hex string (SHA-256)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // Must NOT be the raw phone number
    expect(hash).not.toBe('447700900001')
  })
})
