/**
 * logConsentEvent tests — append-only audit trail.
 *
 * Critical properties: correct fields stored, null userId accepted
 * (pre-registration events), and the function never throws under any
 * DB failure so it can never disrupt the user-facing flow.
 */
import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { logConsentEvent } from '../audit.js'

function makePrisma(createImpl = vi.fn().mockResolvedValue({})): PrismaClient {
  return {
    auditLog: { create: createImpl },
  } as unknown as PrismaClient
}

describe('logConsentEvent', () => {
  it('creates an audit log entry with the correct event type and userId', async () => {
    const prisma = makePrisma()
    await logConsentEvent(prisma, 'bank_connect_completed', 'user-1')

    expect(prisma.auditLog.create).toHaveBeenCalledOnce()
    const data = (vi.mocked(prisma.auditLog.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.eventType).toBe('bank_connect_completed')
    expect(data.userId).toBe('user-1')
  })

  it('sets serviceName to "onboarding"', async () => {
    const prisma = makePrisma()
    await logConsentEvent(prisma, 'user_deleted', 'user-1')

    const data = (vi.mocked(prisma.auditLog.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.serviceName).toBe('onboarding')
  })

  it('accepts null userId for pre-registration events', async () => {
    const prisma = makePrisma()
    await logConsentEvent(prisma, 'bank_connect_token_not_found', null)

    const data = (vi.mocked(prisma.auditLog.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.userId).toBeNull()
  })

  it('stores extra data fields when provided', async () => {
    const prisma = makePrisma()
    await logConsentEvent(prisma, 'bank_connect_failed', 'user-2', { error: 'timeout', provider: 'truelayer' })

    const data = (vi.mocked(prisma.auditLog.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.eventData).toEqual({ error: 'timeout', provider: 'truelayer' })
  })

  it('uses empty object as default eventData', async () => {
    const prisma = makePrisma()
    await logConsentEvent(prisma, 'bank_disconnected', 'user-3')

    const data = (vi.mocked(prisma.auditLog.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.eventData).toEqual({})
  })

  it('never throws when the DB call rejects', async () => {
    const prisma = makePrisma(vi.fn().mockRejectedValue(new Error('DB down')))
    await expect(logConsentEvent(prisma, 'bank_connect_completed', 'user-1')).resolves.toBeUndefined()
  })

  it('never throws when the DB call throws synchronously', async () => {
    const prisma = makePrisma(vi.fn().mockImplementation(() => { throw new Error('sync error') }))
    await expect(logConsentEvent(prisma, 'user_deleted', 'user-1')).resolves.toBeUndefined()
  })

  it('resolves with undefined (void) on success', async () => {
    const prisma = makePrisma()
    const result = await logConsentEvent(prisma, 'bank_connect_link_sent', 'user-4')
    expect(result).toBeUndefined()
  })
})
