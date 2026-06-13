/**
 * Background sync scheduler tests.
 *
 * startSyncScheduler: registers a 6-hour interval, returns it.
 * The sync callback is captured from setInterval and called directly
 * to test runScheduledSync logic without advancing fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../config.js', () => ({
  config: {
    TRUELAYER_CLIENT_ID: 'tl-client',
    TRUELAYER_CLIENT_SECRET: 'tl-secret',
    TRUELAYER_REDIRECT_URI: 'https://example.com/callback',
    TRUELAYER_ENVIRONMENT: 'sandbox',
    ENCRYPTION_KEY: 'a'.repeat(64),
  },
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('access-token')),
  encrypt: vi.fn().mockReturnValue(Buffer.from('encrypted')),
}))

vi.mock('../../../banking/providers/truelayer.js', () => ({
  TrueLayerProvider: vi.fn().mockImplementation(function () {
    return { providerName: 'truelayer' }
  }),
}))

vi.mock('../../../banking/sync.js', () => ({
  runFullSync: vi.fn().mockResolvedValue({
    accountsSynced: 2,
    transactionsImported: 50,
    transactionsSkipped: 0,
    errors: [],
  }),
}))

vi.mock('../../../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import { startSyncScheduler } from '../scheduler.js'
import { runFullSync } from '../../../banking/sync.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConnection(id: string, withRefresh = false) {
  return {
    id,
    userId: `user-${id}`,
    accessTokenEnc: Buffer.from('encrypted-access'),
    refreshTokenEnc: withRefresh ? Buffer.from('encrypted-refresh') : null,
    tokenExpiresAt: null,
    consentScopes: ['accounts', 'transactions'],
    providerConsentId: `consent-${id}`,
  }
}

function makePrisma(connections: ReturnType<typeof makeConnection>[] = [makeConnection('conn-1')]): PrismaClient {
  return {
    bankConnection: {
      findMany: vi.fn().mockResolvedValue(connections),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

/**
 * Starts the scheduler and captures the callback registered with setInterval.
 * Returns the callback so tests can invoke it directly.
 */
function captureCallback(prisma: PrismaClient): { callback: () => Promise<void>; interval: ReturnType<typeof setInterval> } {
  let capturedCallback: (() => void) | undefined
  const originalSetInterval = globalThis.setInterval
  const spyInterval = vi.spyOn(globalThis, 'setInterval').mockImplementationOnce((fn) => {
    capturedCallback = fn as () => void
    return originalSetInterval(() => undefined, 999_999_999)
  })

  const interval = startSyncScheduler(prisma)
  spyInterval.mockRestore()

  return {
    callback: async () => {
      if (capturedCallback) capturedCallback()
      // Let all microtasks/promises settle
      await new Promise((r) => setTimeout(r, 0))
    },
    interval,
  }
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000

// ── startSyncScheduler ────────────────────────────────────────────────────────

describe('startSyncScheduler', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('returns an interval object', () => {
    const prisma = makePrisma()
    const interval = startSyncScheduler(prisma)
    expect(interval).toBeDefined()
    clearInterval(interval)
  })

  it('registers the interval with a 6-hour delay', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    const prisma = makePrisma()
    const interval = startSyncScheduler(prisma)
    expect(spy).toHaveBeenCalledWith(expect.any(Function), SIX_HOURS_MS)
    spy.mockRestore()
    clearInterval(interval)
  })

  it('does not sync immediately on startup', () => {
    const prisma = makePrisma()
    const interval = startSyncScheduler(prisma)
    expect(prisma.bankConnection.findMany).not.toHaveBeenCalled()
    clearInterval(interval)
  })
})

// ── runScheduledSync (via captured callback) ──────────────────────────────────

describe('runScheduledSync — happy path', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('fetches active truelayer connections', async () => {
    const prisma = makePrisma()
    const { callback, interval } = captureCallback(prisma)
    await callback()
    expect(prisma.bankConnection.findMany).toHaveBeenCalledOnce()
    const query = vi.mocked(prisma.bankConnection.findMany).mock.calls[0]![0] as {
      where: Record<string, unknown>
    }
    expect(query.where.consentStatus).toBe('active')
    expect(query.where.provider).toBe('truelayer')
    clearInterval(interval)
  })

  it('calls runFullSync for each connection', async () => {
    const prisma = makePrisma([makeConnection('c1'), makeConnection('c2')])
    const { callback, interval } = captureCallback(prisma)
    await callback()
    expect(runFullSync).toHaveBeenCalledTimes(2)
    clearInterval(interval)
  })

  it('skips sync when no connections are active', async () => {
    const prisma = makePrisma([])
    const { callback, interval } = captureCallback(prisma)
    await callback()
    expect(runFullSync).not.toHaveBeenCalled()
    clearInterval(interval)
  })

  it('passes refresh token to sync when connection has one', async () => {
    const prisma = makePrisma([makeConnection('c1', true)])
    const { callback, interval } = captureCallback(prisma)
    await callback()
    expect(runFullSync).toHaveBeenCalledOnce()
    const consent = vi.mocked(runFullSync).mock.calls[0]![3] as unknown as Record<string, unknown>
    expect(consent.refreshToken).toBe('access-token') // decrypt mock returns 'access-token'
    clearInterval(interval)
  })
})

describe('startSyncScheduler — catch on runScheduledSync throw', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('swallows unhandled rejection when runScheduledSync throws', async () => {
    const prisma = {
      bankConnection: {
        findMany: vi.fn().mockRejectedValue(new Error('DB down')),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient
    const { callback, interval } = captureCallback(prisma)
    // Should not throw even though runScheduledSync rejects
    await expect(callback()).resolves.not.toThrow()
    clearInterval(interval)
  })
})

describe('runScheduledSync — error isolation', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('continues syncing remaining connections when one fails', async () => {
    vi.mocked(runFullSync)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ accountsSynced: 1, transactionsImported: 10, transactionsSkipped: 0, errors: [] })

    const prisma = makePrisma([makeConnection('c1'), makeConnection('c2')])
    const { callback, interval } = captureCallback(prisma)
    await callback()
    expect(runFullSync).toHaveBeenCalledTimes(2)
    clearInterval(interval)
  })

  it('marks failed connection with lastSyncStatus error', async () => {
    vi.mocked(runFullSync).mockRejectedValueOnce(new Error('API down'))
    const prisma = makePrisma([makeConnection('c1')])
    const { callback, interval } = captureCallback(prisma)
    await callback()
    expect(prisma.bankConnection.update).toHaveBeenCalledOnce()
    const arg = vi.mocked(prisma.bankConnection.update).mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(arg.data.lastSyncStatus).toBe('error')
    clearInterval(interval)
  })

  it('does not throw when bankConnection.update fails during error handling', async () => {
    vi.mocked(runFullSync).mockRejectedValueOnce(new Error('sync failed'))
    const prisma = makePrisma([makeConnection('c1')])
    vi.mocked(prisma.bankConnection.update).mockRejectedValueOnce(new Error('update failed'))
    const { callback, interval } = captureCallback(prisma)
    await expect(callback()).resolves.not.toThrow()
    clearInterval(interval)
  })

  it('handles non-Error rejection values in lastSyncError', async () => {
    // covers the String(err) branch when err is not an Error instance
    vi.mocked(runFullSync).mockRejectedValueOnce('string-error')
    const prisma = makePrisma([makeConnection('c1')])
    const { callback, interval } = captureCallback(prisma)
    await callback()
    const arg = vi.mocked(prisma.bankConnection.update).mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(arg.data.lastSyncError).toBe('string-error')
    clearInterval(interval)
  })

  it('includes tokenExpiresAt in consent when connection has it', async () => {
    const expiresAt = new Date('2025-12-31')
    const connWithExpiry = { ...makeConnection('c1'), tokenExpiresAt: expiresAt }
    const prisma = makePrisma([connWithExpiry])
    const { callback, interval } = captureCallback(prisma)
    await callback()
    const consent = vi.mocked(runFullSync).mock.calls[0]![3] as unknown as Record<string, unknown>
    expect(consent.tokenExpiresAt).toEqual(expiresAt)
    clearInterval(interval)
  })
})
