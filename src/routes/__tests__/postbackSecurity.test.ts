/**
 * Tests that CJ and Impact postback endpoints enforce signature verification
 * when the respective secret is configured.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createHmac } from 'crypto'

vi.mock('../../services/affiliate/clickTrackingService.js', () => ({
  recordRedirect: vi.fn(),
  recordPostback: vi.fn().mockResolvedValue(undefined),
  generateClickUrl: vi.fn().mockResolvedValue('https://monika.app/r/test'),
  checkForFraud: vi.fn().mockResolvedValue({ isSuspicious: false }),
}))

vi.mock('../../plugins/prisma.js', () => ({
  default: async (app: { decorate: (k: string, v: unknown) => void }) => {
    app.decorate('prisma', {})
  },
}))

vi.mock('../../config.js', () => ({
  config: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    ADMIN_USERNAME: 'testadmin',
    ADMIN_PASSWORD: 'testpassword1',
    WHATSAPP_APP_SECRET: 'test-app-secret',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    AFFILIATE_POSTBACK_SECRET: 'awin-secret',
    CJ_POSTBACK_SECRET: 'cj-secret',
    IMPACT_POSTBACK_SECRET: 'impact-secret',
    REDIS_URL: 'redis://localhost:6379',
    APP_BASE_URL: 'http://localhost:3000',
    TRUELAYER_WEBHOOK_SECRET: '',
    ENCRYPTION_KEY: '',
    SECRET_KEY: '',
    ANTHROPIC_API_KEY: '',
  },
}))

import { buildApp } from '../../app.js'

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

const CJ_PAYLOAD = {
  sid: 'MONIKA_usr_1_offer_2_123',
  orderId: 'cj-order-1',
  commissionAmount: 50,
  actionStatus: 'approved',
}

const IMPACT_PAYLOAD = {
  SubId1: 'MONIKA_usr_1_offer_2_456',
  OrderId: 'impact-order-1',
  PubCommissionAmount: 30,
  ActionStatus: 'approved',
}

describe('CJ postback signature verification', () => {
  it('returns 401 when no signature header provided', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/cj',
      payload: CJ_PAYLOAD,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 401 when signature is wrong', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/cj',
      headers: { 'x-cj-signature': 'wrong-sig' },
      payload: CJ_PAYLOAD,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 200 with valid HMAC signature', async () => {
    const app = await buildApp()
    const body = JSON.stringify(CJ_PAYLOAD)
    const sig = sign(body, 'cj-secret')

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/cj',
      headers: { 'x-cj-signature': sig, 'content-type': 'application/json' },
      payload: CJ_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

describe('Impact postback signature verification', () => {
  it('returns 401 when no signature header provided', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/impact',
      payload: IMPACT_PAYLOAD,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 401 when signature is wrong', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/impact',
      headers: { 'x-impact-signature': 'bad-sig' },
      payload: IMPACT_PAYLOAD,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 200 with valid HMAC signature', async () => {
    const app = await buildApp()
    const body = JSON.stringify(IMPACT_PAYLOAD)
    const sig = sign(body, 'impact-secret')

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/impact',
      headers: { 'x-impact-signature': sig, 'content-type': 'application/json' },
      payload: IMPACT_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
