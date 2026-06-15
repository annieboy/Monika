import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import signupRoutes from '../index.js'

vi.mock('../../../lib/crypto.js', () => ({
  hashPhoneNumber: vi.fn(() => 'hash-abc'),
  encrypt: vi.fn(() => Buffer.from('encrypted')),
}))

vi.mock('../../../services/whatsapp/sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wam-1' }),
}))

vi.mock('../../../config.js', () => ({
  config: {
    SECRET_KEY: 'test-secret',
    ENCRYPTION_KEY: 'a'.repeat(64),
    WHATSAPP_PHONE_NUMBER_ID: '',
    WHATSAPP_ACCESS_TOKEN: '',
  },
}))

function makePrisma(): PrismaClient {
  return {
    user: {
      upsert: vi.fn().mockResolvedValue({ id: 'user-1' }),
    },
  } as unknown as PrismaClient
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorate('prisma', makePrisma())
  await app.register(signupRoutes)
  await app.ready()
  return app
}

describe('GET /signup', () => {
  it('returns signup form HTML', async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/signup' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toMatch(/WhatsApp/)
    expect(res.body).toMatch(/phone/)
  })
})

describe('POST /signup', () => {
  let app: FastifyInstance
  beforeEach(async () => { app = await buildTestApp() })

  it('redirects to /signup/sent on valid UK number', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/signup',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'phone=07700900000',
    })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toBe('/signup/sent')
  })

  it('returns form with error on invalid phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/signup',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'phone=notaphone',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/valid.*phone|phone.*valid/i)
  })
})

describe('GET /signup/sent', () => {
  it('returns check-whatsapp confirmation page', async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/signup/sent' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatch(/WhatsApp/i)
    expect(res.body).toMatch(/Hi/i)
  })
})
