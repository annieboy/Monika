import { describe, it, expect, vi, beforeAll } from 'vitest'
import { buildApp } from '../../app.js'

// Mock the affiliate click tracking service — no DB in unit tests
vi.mock('../../services/affiliate/clickTrackingService.js', () => ({
  recordRedirect: vi.fn(),
  recordPostback: vi.fn(),
  generateClickUrl: vi.fn().mockResolvedValue('https://monika.app/r/test123'),
  checkForFraud: vi.fn().mockResolvedValue({ isSuspicious: false }),
}))

// Mock prismaPlugin so no real DB connection is needed
vi.mock('../../plugins/prisma.js', () => ({
  default: async (app: { prisma: unknown; decorate: (k: string, v: unknown) => void }) => {
    app.decorate('prisma', {})
  },
}))

 
let recordRedirect: any
 
let recordPostback: any

beforeAll(async () => {
  const mod = await import('../../services/affiliate/clickTrackingService.js')
  recordRedirect = mod.recordRedirect
  recordPostback = mod.recordPostback
})

describe('GET /r/:shortCode', () => {
  it('redirects to partner URL when short code found', async () => {
    vi.mocked(recordRedirect).mockResolvedValueOnce({
      redirectUrl: 'https://www.vodafone.co.uk?ref=MONIKA_123',
      opportunityId: 'opp-1',
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/r/xK9mPqRt' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://www.vodafone.co.uk?ref=MONIKA_123')
    await app.close()
  })

  it('returns 404 when short code not found', async () => {
    vi.mocked(recordRedirect).mockResolvedValueOnce(null)

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/r/notexist' })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns 400 for short code longer than 16 chars', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/r/' + 'a'.repeat(20) })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /webhooks/affiliate/awin', () => {
  it('records postback and returns 200', async () => {
    vi.mocked(recordPostback).mockResolvedValueOnce(undefined)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/awin',
      payload: {
        clickRef: 'MONIKA_usr_123_offer_abc_1718000000',
        transactionId: 'awin-txn-xyz',
        commissionAmount: 25.00,
        status: 'approved',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    await app.close()
  })

  it('returns 400 when clickRef is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/awin',
      payload: { transactionId: 'txn-123', commissionAmount: 25 },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 400 when transactionId is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/awin',
      payload: { clickRef: 'MONIKA_abc', commissionAmount: 25 },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /webhooks/affiliate/cj', () => {
  it('records postback and returns 200', async () => {
    vi.mocked(recordPostback).mockResolvedValueOnce(undefined)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/cj',
      payload: {
        sid: 'MONIKA_usr_456_offer_def_1718000001',
        orderId: 'cj-order-789',
        commissionAmount: 70.00,
        actionStatus: 'approved',
      },
    })

    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('returns 400 when sid is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/cj',
      payload: { orderId: 'cj-123' },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /webhooks/affiliate/impact', () => {
  it('records postback and returns 200', async () => {
    vi.mocked(recordPostback).mockResolvedValueOnce(undefined)

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/impact',
      payload: {
        SubId1: 'MONIKA_usr_789_offer_ghi_1718000002',
        OrderId: 'impact-order-321',
        PubCommissionAmount: 30.00,
        ActionStatus: 'approved',
      },
    })

    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('returns 400 when SubId1 is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/affiliate/impact',
      payload: { OrderId: 'impact-123' },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
