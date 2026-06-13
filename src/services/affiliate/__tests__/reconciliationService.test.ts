import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

// Stub global fetch — reconciliation calls external APIs
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock config so tests can control API key presence
vi.mock('../../../config.js', () => ({
  config: {
    AWIN_API_KEY: '',
    AWIN_PUBLISHER_ID: '',
    CJ_API_KEY: '',
    CJ_PUBLISHER_ID: '',
    IMPACT_ACCOUNT_SID: '',
    IMPACT_AUTH_TOKEN: '',
    REDIS_URL: 'redis://localhost:6379',
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
  },
}))

import { reconcileCommissions } from '../reconciliationService.js'
import { config } from '../../../config.js'

function makePrisma(clicks: unknown[] = []): PrismaClient {
  return {
    affiliateClick: {
      findMany: vi.fn().mockResolvedValue(clicks),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { commissionAmount: null }, _count: { _all: 0 } }),
    },
  } as unknown as PrismaClient
}

describe('reconcileCommissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset all API keys to empty (no-op)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = config as any
    c.AWIN_API_KEY = ''
    c.AWIN_PUBLISHER_ID = ''
    c.CJ_API_KEY = ''
    c.CJ_PUBLISHER_ID = ''
    c.IMPACT_ACCOUNT_SID = ''
    c.IMPACT_AUTH_TOKEN = ''
  })

  it('returns zero counts when no pending clicks exist', async () => {
    const prisma = makePrisma([])
    const result = await reconcileCommissions(prisma)

    expect(result).toEqual({ checked: 0, updated: 0, errors: 0 })
    expect(prisma.affiliateClick.update).not.toHaveBeenCalled()
  })

  it('skips API calls when credentials are not configured', async () => {
    const clicks = [
      { id: 'click-1', clickRef: 'MONIKA_abc', affiliateNetwork: 'awin', commissionStatus: 'PENDING' },
      { id: 'click-2', clickRef: 'MONIKA_def', affiliateNetwork: 'cj',   commissionStatus: 'PENDING' },
    ]
    const prisma = makePrisma(clicks)
    const result = await reconcileCommissions(prisma)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.checked).toBe(2)
    expect(result.updated).toBe(0)
  })

  it('updates commission status when API returns new status', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(config as any, { AWIN_API_KEY: 'test-key', AWIN_PUBLISHER_ID: '12345' })

    const clicks = [
      { id: 'click-1', clickRef: 'MONIKA_abc', affiliateNetwork: 'awin', commissionStatus: 'PENDING' },
    ]
    const prisma = makePrisma(clicks)

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ clickRef: 'MONIKA_abc', commissionStatus: 'approved' }],
    })

    const result = await reconcileCommissions(prisma)

    expect(result.checked).toBe(1)
    expect(result.updated).toBe(1)
    expect(prisma.affiliateClick.update).toHaveBeenCalledWith({
      where: { id: 'click-1' },
      data: expect.objectContaining({ commissionStatus: 'APPROVED' }),
    })
  })

  it('does not update when API status matches current status', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(config as any, { AWIN_API_KEY: 'test-key', AWIN_PUBLISHER_ID: '12345' })

    const clicks = [
      { id: 'click-1', clickRef: 'MONIKA_abc', affiliateNetwork: 'awin', commissionStatus: 'PENDING' },
    ]
    const prisma = makePrisma(clicks)

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ clickRef: 'MONIKA_abc', commissionStatus: 'pending' }],
    })

    const result = await reconcileCommissions(prisma)

    expect(result.updated).toBe(0)
    expect(prisma.affiliateClick.update).not.toHaveBeenCalled()
  })

  it('continues gracefully when API call fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(config as any, { AWIN_API_KEY: 'test-key', AWIN_PUBLISHER_ID: '12345' })

    const clicks = [
      { id: 'click-1', clickRef: 'MONIKA_abc', affiliateNetwork: 'awin', commissionStatus: 'PENDING' },
    ]
    const prisma = makePrisma(clicks)

    mockFetch.mockRejectedValueOnce(new Error('Network timeout'))

    // Should not throw — network errors are caught and logged
    const result = await reconcileCommissions(prisma)

    expect(result.updated).toBe(0)
    expect(result.checked).toBe(1)
  })

  it('handles non-ok API response gracefully', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(config as any, { AWIN_API_KEY: 'test-key', AWIN_PUBLISHER_ID: '12345' })

    const clicks = [
      { id: 'click-1', clickRef: 'MONIKA_abc', affiliateNetwork: 'awin', commissionStatus: 'PENDING' },
    ]
    const prisma = makePrisma(clicks)

    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 })

    const result = await reconcileCommissions(prisma)

    expect(result.updated).toBe(0)
    expect(result.errors).toBe(0) // non-ok response logs warning but doesn't throw
  })

  it('sets commissionLockedAt when commission is APPROVED', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(config as any, { AWIN_API_KEY: 'test-key', AWIN_PUBLISHER_ID: '12345' })

    const clicks = [
      { id: 'click-1', clickRef: 'MONIKA_abc', affiliateNetwork: 'awin', commissionStatus: 'PENDING' },
    ]
    const prisma = makePrisma(clicks)

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ clickRef: 'MONIKA_abc', commissionStatus: 'approved' }],
    })

    await reconcileCommissions(prisma)

    expect(prisma.affiliateClick.update).toHaveBeenCalledWith({
      where: { id: 'click-1' },
      data: expect.objectContaining({
        commissionStatus: 'APPROVED',
        commissionLockedAt: expect.any(Date),
      }),
    })
  })
})

describe('commission status mapping', () => {
  // Verify status mapping via integration through reconcileCommissions
  const statusMappings = [
    { network: 'awin', apiStatus: 'approved',  expected: 'APPROVED' },
    { network: 'awin', apiStatus: 'declined',  expected: 'REJECTED' },
    { network: 'awin', apiStatus: 'deleted',   expected: 'REVERSED' },
  ]

  for (const { network, apiStatus, expected } of statusMappings) {
    it(`maps ${network} "${apiStatus}" → ${expected}`, async () => {
      process.env['AWIN_API_KEY']      = 'test-key'
      process.env['AWIN_PUBLISHER_ID'] = '12345'

      const clicks = [
        { id: 'click-1', clickRef: 'MONIKA_abc', affiliateNetwork: network, commissionStatus: 'PENDING' },
      ]
      const prisma = makePrisma(clicks)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ clickRef: 'MONIKA_abc', commissionStatus: apiStatus }],
      })

      await reconcileCommissions(prisma)

      if (expected) {
        expect(prisma.affiliateClick.update).toHaveBeenCalledWith({
          where: { id: 'click-1' },
          data: expect.objectContaining({ commissionStatus: expected }),
        })
      }
    })
  }
})
