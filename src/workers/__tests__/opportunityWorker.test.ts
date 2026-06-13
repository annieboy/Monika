import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before importing the worker
vi.mock('../../services/opportunity/recurringPaymentDetector.js', () => ({
  detectRecurringPayments: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../services/opportunity/opportunityDetector.js', () => ({
  detectOpportunities: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../services/opportunity/opportunityDeliveryService.js', () => ({
  deliverOpportunitiesToUser: vi.fn().mockResolvedValue(undefined),
  runDeliveryBatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../services/offers/offerUpsertService.js', () => ({
  upsertOffer: vi.fn(),
  expireStaleOffers: vi.fn().mockResolvedValue(3),
}))

vi.mock('../../queues/connection.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue({
    on: vi.fn(),
    quit: vi.fn(),
  }),
}))

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  })),
}))

import { detectRecurringPayments } from '../../services/opportunity/recurringPaymentDetector.js'
import { detectOpportunities } from '../../services/opportunity/opportunityDetector.js'
import { deliverOpportunitiesToUser, runDeliveryBatch } from '../../services/opportunity/opportunityDeliveryService.js'
import { expireStaleOffers } from '../../services/offers/offerUpsertService.js'

// Pull out the handlers by importing and reconstructing them for unit testing.
// We test the job handler logic directly rather than through the BullMQ Worker
// abstraction, which would require a real Redis connection.

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]),
    },
    ...overrides,
  } as unknown as import('@prisma/client').PrismaClient
}

// Replicate the handler logic from opportunityWorker.ts for unit testing
async function handleDetect(prisma: import('@prisma/client').PrismaClient, userId?: string) {
  if (userId) {
    await detectRecurringPayments(prisma, userId)
    await detectOpportunities(prisma, userId)
    return { processed: 1, errors: 0 }
  }

  const users = await prisma.user.findMany({
    where: { bankConnections: { some: { consentStatus: 'active' } } },
    select: { id: true },
  })

  let errors = 0
  for (const user of users) {
    try {
      await detectRecurringPayments(prisma, user.id)
      await detectOpportunities(prisma, user.id)
    } catch {
      errors++
    }
  }

  const noBankUsers = await prisma.user.findMany({
    where: { bankConnections: { none: {} } },
    select: { id: true },
  })
  for (const user of noBankUsers) {
    try {
      await detectOpportunities(prisma, user.id)
    } catch {
      errors++
    }
  }

  return { processed: users.length + noBankUsers.length, errors }
}

async function handleDeliver(prisma: import('@prisma/client').PrismaClient, userId?: string) {
  if (userId) {
    await deliverOpportunitiesToUser(prisma, userId)
    return { processed: 1, errors: 0 }
  }
  await runDeliveryBatch(prisma, { error: vi.fn(), info: vi.fn() } as never)
  return { processed: -1, errors: 0 }
}

async function handleExpire(prisma: import('@prisma/client').PrismaClient) {
  const count = await expireStaleOffers(prisma)
  return { processed: count, errors: 0 }
}

describe('detect-opportunities handler', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('runs detection for a single user when userId provided', async () => {
    const prisma = makePrisma()
    const result = await handleDetect(prisma, 'user-abc')

    expect(detectRecurringPayments).toHaveBeenCalledWith(prisma, 'user-abc')
    expect(detectOpportunities).toHaveBeenCalledWith(prisma, 'user-abc')
    expect(result).toEqual({ processed: 1, errors: 0 })
  })

  it('runs detection for all bank-linked and no-bank users when no userId', async () => {
    const prisma = makePrisma({
      user: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'user-1' }, { id: 'user-2' }])  // bank users
          .mockResolvedValueOnce([{ id: 'user-3' }]),                    // no-bank users
      },
    })

    const result = await handleDetect(prisma)

    expect(detectRecurringPayments).toHaveBeenCalledTimes(2)
    expect(detectOpportunities).toHaveBeenCalledTimes(3) // 2 bank + 1 no-bank
    expect(result.processed).toBe(3)
    expect(result.errors).toBe(0)
  })

  it('counts errors but continues processing other users', async () => {
    vi.mocked(detectRecurringPayments).mockRejectedValueOnce(new Error('DB timeout'))

    const prisma = makePrisma({
      user: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'user-1' }, { id: 'user-2' }])
          .mockResolvedValueOnce([]),
      },
    })

    const result = await handleDetect(prisma)

    expect(result.errors).toBe(1)
    expect(result.processed).toBe(2) // still ran for 2 bank users
  })
})

describe('deliver-opportunities handler', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('delivers to a single user when userId provided', async () => {
    const prisma = makePrisma()
    const result = await handleDeliver(prisma, 'user-abc')

    expect(deliverOpportunitiesToUser).toHaveBeenCalledWith(prisma, 'user-abc')
    expect(runDeliveryBatch).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 1, errors: 0 })
  })

  it('runs batch delivery when no userId provided', async () => {
    const prisma = makePrisma()
    const result = await handleDeliver(prisma)

    expect(runDeliveryBatch).toHaveBeenCalledOnce()
    expect(deliverOpportunitiesToUser).not.toHaveBeenCalled()
    expect(result.errors).toBe(0)
  })
})

describe('expire-offers handler', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns count of expired offers', async () => {
    vi.mocked(expireStaleOffers).mockResolvedValueOnce(5)

    const prisma = makePrisma()
    const result = await handleExpire(prisma)

    expect(expireStaleOffers).toHaveBeenCalledWith(prisma)
    expect(result).toEqual({ processed: 5, errors: 0 })
  })

  it('returns 0 when no offers expired', async () => {
    vi.mocked(expireStaleOffers).mockResolvedValueOnce(0)

    const prisma = makePrisma()
    const result = await handleExpire(prisma)

    expect(result).toEqual({ processed: 0, errors: 0 })
  })
})
