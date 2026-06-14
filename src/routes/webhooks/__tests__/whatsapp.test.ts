import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

function makeStatusPayload(wamid: string, status: string): string {
  return JSON.stringify({
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
              statuses: [
                {
                  id: wamid,
                  status,
                  timestamp: '1717776100',
                  recipient_id: '447700900001',
                },
              ],
            },
          },
        ],
      },
    ],
  })
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
      // Simulate a fully-onboarded user so onboardingFlow short-circuits
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        fullNameEnc: Buffer.from('Test'),
        termsAcceptedAt: new Date('2024-01-01'),
        gdprConsentAt: new Date('2024-01-01'),
      }),
    },
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'conv-uuid' }),
      update: vi.fn().mockResolvedValue({}),
    },
    userOpportunityPreferences: {
      // Simulate existing prefs so consent prompt is not appended in route tests
      findUnique: vi.fn().mockResolvedValue({ opportunitiesConsent: true }),
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

// Mock the rate limiter so tests don't need Redis
vi.mock('../../../lib/userRateLimit.js', () => ({
  checkUserRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSecs: 0 }),
}))

// Mock the opportunity handler so tests don't need DB opportunity tables
vi.mock('../../../services/conversation/opportunityConversationHandler.js', () => ({
  handleOpportunityReply: vi.fn().mockResolvedValue({ handled: false, response: '' }),
}))

// Mock the sender so tests don't hit the real Meta API
vi.mock('../../../services/whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid.outbound' }),
  SendError: class SendError extends Error {
    statusCode: number | undefined
    constructor(message: string, statusCode?: number) {
      super(message)
      this.name = 'SendError'
      this.statusCode = statusCode
    }
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

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

describe('POST /webhooks/whatsapp — inbound text messages', () => {
  let prisma: PrismaClient
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
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
    // Two creates: one for the inbound 'user' message, one for the 'assistant' reply
    expect(prisma.conversation.create).toHaveBeenCalledTimes(2)
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
                statuses: [{ id: 'wamid.status', status: 'delivered', timestamp: '123', recipient_id: '447' }],
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

// ── POST /webhooks/whatsapp — outbound send ────────────────────────────────

describe('POST /webhooks/whatsapp — outbound reply', () => {
  let prisma: PrismaClient
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = makeMockPrisma()
    app = await buildTestApp(prisma)
  })

  it('calls sendWhatsAppMessage when credentials are configured', async () => {
    const { sendWhatsAppMessage } = await import('../../../services/whatsapp/sender.js')
    const body = makePayload()
    const sig = sign(body, APP_SECRET)

    await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    // Allow the fire-and-forget promise to settle
    await vi.runAllTimersAsync().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 10))

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      '447700900001',    // recipient from payload
      expect.any(String), // AI response text
      expect.any(String), // phoneNumberId from config
      expect.any(String), // accessToken from config
    )
  })

  it('still returns 200 even when sendWhatsAppMessage rejects', async () => {
    const { sendWhatsAppMessage } = await import('../../../services/whatsapp/sender.js')
    ;(sendWhatsAppMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network failure'),
    )

    const body = makePayload()
    const sig = sign(body, APP_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.statusCode).toBe(200)
  })
})

// ── POST /webhooks/whatsapp — status updates ───────────────────────────────

describe('POST /webhooks/whatsapp — delivery status updates', () => {
  let prisma: PrismaClient
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = makeMockPrisma()
    // Make conversation findFirst return a matching row for status updates
    ;(prisma.conversation.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ id: 'conv-assistant', waStatus: 'sent' })
    app = await buildTestApp(prisma)
  })

  it('returns 200 for a delivery status payload', async () => {
    const body = makeStatusPayload('wamid.outbound123', 'delivered')
    const sig = sign(body, APP_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.statusCode).toBe(200)
  })

  it('does not create conversation rows for status-only payloads', async () => {
    // findFirst returns null for dedup check when there's no message
    ;(prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const body = makeStatusPayload('wamid.outbound123', 'read')
    const sig = sign(body, APP_SECRET)

    await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(prisma.conversation.create).not.toHaveBeenCalled()
  })
})

// ── POST /webhooks/whatsapp — replay attack protection ───────────────────

describe('POST /webhooks/whatsapp — replay attack protection', () => {
  it('accepts a request with a current X-Hub-Timestamp', async () => {
    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

    const body = makePayload()
    const sig = sign(body, APP_SECRET)
    const nowSeconds = Math.floor(Date.now() / 1000)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
        'x-hub-timestamp': String(nowSeconds),
      },
      body,
    })

    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('rejects a request with an X-Hub-Timestamp older than 5 minutes', async () => {
    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

    const body = makePayload()
    const sig = sign(body, APP_SECRET)
    const staleSeconds = Math.floor(Date.now() / 1000) - 6 * 60 // 6 minutes ago

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
        'x-hub-timestamp': String(staleSeconds),
      },
      body,
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('rejects a request with a future X-Hub-Timestamp (>30 s ahead)', async () => {
    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

    const body = makePayload()
    const sig = sign(body, APP_SECRET)
    const futureSeconds = Math.floor(Date.now() / 1000) + 120 // 2 minutes in future

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
        'x-hub-timestamp': String(futureSeconds),
      },
      body,
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('accepts a request without X-Hub-Timestamp (header is optional)', async () => {
    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

    const body = makePayload()
    const sig = sign(body, APP_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sig,
        // No x-hub-timestamp header
      },
      body,
    })

    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

// ── POST /webhooks/whatsapp — rate limit exceeded ─────────────────────────

describe('POST /webhooks/whatsapp — rate limit exceeded', () => {
  it('returns 200 without processing when rate limit exceeded', async () => {
    const { checkUserRateLimit } = await import('../../../lib/userRateLimit.js')
    ;(checkUserRateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false, retryAfterSecs: 30 })

    const prisma = makeMockPrisma()
    const app = await buildTestApp(prisma)

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
    // processInboundMessage stores conversations — none should have been created
    expect(prisma.conversation.create).not.toHaveBeenCalled()

    await app.close()
  })
})
