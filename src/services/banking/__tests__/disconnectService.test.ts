import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { disconnectAllBanks } from '../disconnectService.js'

vi.mock('../../../lib/crypto.js', () => ({ decrypt: vi.fn(() => Buffer.from('tok')) }))
vi.mock('../../../config.js', () => ({
  config: {
    ENCRYPTION_KEY: 'a'.repeat(64),
    TRUELAYER_CLIENT_ID: '', // empty → skip provider revocation in test
    TRUELAYER_CLIENT_SECRET: '',
    TRUELAYER_REDIRECT_URI: 'https://x/cb',
    TRUELAYER_ENVIRONMENT: 'sandbox',
  },
}))
vi.mock('../../onboarding/audit.js', () => ({ logConsentEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

function makePrisma(active: number) {
  const conns = Array.from({ length: active }, (_, i) => ({
    id: `conn-${i}`, provider: 'truelayer', accessTokenEnc: Buffer.from('enc'),
  }))
  return {
    bankConnection: {
      findMany: vi.fn().mockResolvedValue(conns),
      update: vi.fn().mockResolvedValue({}),
    },
    account: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as PrismaClient
}

describe('disconnectAllBanks', () => {
  it('revokes each active connection and deactivates its accounts', async () => {
    const prisma = makePrisma(2)
    const result = await disconnectAllBanks(prisma, 'user-1')
    expect(result.disconnected).toBe(2)
    expect(prisma.bankConnection.update).toHaveBeenCalledTimes(2)
    expect(prisma.account.updateMany).toHaveBeenCalledTimes(2)
  })

  it('returns 0 when there is no active connection', async () => {
    const prisma = makePrisma(0)
    const result = await disconnectAllBanks(prisma, 'user-1')
    expect(result.disconnected).toBe(0)
    expect(prisma.bankConnection.update).not.toHaveBeenCalled()
  })
})
