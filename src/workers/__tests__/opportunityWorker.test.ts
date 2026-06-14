/**
 * opportunityWorker tests — tests the actual startOpportunityWorker function
 * by capturing the BullMQ job handler callback and invoking it directly.
 *
 * Verifies: detect-opportunities (single user, all users, error isolation),
 * deliver-opportunities (single user, batch), expire-offers, reconcile-commissions,
 * and unknown job type throws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Worker } from 'bullmq'
import type { PrismaClient } from '@prisma/client'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../services/opportunity/recurringPaymentDetector.js', () => ({
  detectRecurringPayments: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../services/opportunity/opportunityDetector.js', () => ({
  detectOpportunities: vi.fn().mockResolvedValue(0),
}))

vi.mock('../../services/opportunity/opportunityDeliveryService.js', () => ({
  deliverOpportunitiesToUser: vi.fn().mockResolvedValue(undefined),
  runDeliveryBatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../services/offers/offerUpsertService.js', () => ({
  expireStaleOffers: vi.fn().mockResolvedValue(3),
}))

vi.mock('../../services/affiliate/reconciliationService.js', () => ({
  reconcileCommissions: vi.fn().mockResolvedValue({ checked: 5, errors: 0 }),
}))

vi.mock('../../services/analytics/monthlyAggregationService.js', () => ({
  runMonthlyAggregationBatch: vi.fn().mockResolvedValue({ aggregated: 7, errors: 0 }),
}))

vi.mock('../../services/analytics/anomalyScoreService.js', () => ({
  runAnomalyScoreBatch: vi.fn().mockResolvedValue({ scored: 12, errors: 0 }),
}))

vi.mock('../../services/analytics/anomalyAlertService.js', () => ({
  runAnomalyAlertBatch: vi.fn().mockResolvedValue({ alerted: 3, errors: 0 }),
}))

vi.mock('../../queues/connection.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue({ on: vi.fn(), quit: vi.fn() }),
}))

vi.mock('../../queues/opportunityQueue.js', () => ({
  OPPORTUNITY_QUEUE: 'opportunity-engine',
}))

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function (_queue: string, _handler: unknown) {
    return { on: vi.fn() }
  }),
}))

import { startOpportunityWorker } from '../opportunityWorker.js'
import { detectRecurringPayments } from '../../services/opportunity/recurringPaymentDetector.js'
import { detectOpportunities } from '../../services/opportunity/opportunityDetector.js'
import { deliverOpportunitiesToUser, runDeliveryBatch } from '../../services/opportunity/opportunityDeliveryService.js'
import { expireStaleOffers } from '../../services/offers/offerUpsertService.js'
import { reconcileCommissions } from '../../services/affiliate/reconciliationService.js'
import { runMonthlyAggregationBatch } from '../../services/analytics/monthlyAggregationService.js'
import { runAnomalyScoreBatch } from '../../services/analytics/anomalyScoreService.js'
import { runAnomalyAlertBatch } from '../../services/analytics/anomalyAlertService.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePrisma(opts: { bankUsers?: { id: string }[]; noBankUsers?: { id: string }[] } = {}): PrismaClient {
  const bankUsers = opts.bankUsers ?? [{ id: 'user-1' }, { id: 'user-2' }]
  const noBankUsers = opts.noBankUsers ?? []
  return {
    user: {
      findMany: vi.fn()
        .mockResolvedValueOnce(bankUsers)
        .mockResolvedValue(noBankUsers),
    },
  } as unknown as PrismaClient
}

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { id: 'job-1', name, data }
}

/** Starts the worker and returns the captured BullMQ job handler. */
function captureHandler(prisma: PrismaClient) {
  startOpportunityWorker(prisma)
  const workerCall = vi.mocked(Worker).mock.calls[0]
  return workerCall![1] as (job: ReturnType<typeof makeJob>) => Promise<unknown>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('startOpportunityWorker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('instantiates a BullMQ Worker and returns it', () => {
    const prisma = makePrisma()
    const worker = startOpportunityWorker(prisma)
    expect(Worker).toHaveBeenCalledOnce()
    expect(worker).toBeDefined()
  })
})

describe('job: detect-opportunities — single user', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs detection for the specified user', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('detect-opportunities', { userId: 'user-abc' }))
    expect(detectRecurringPayments).toHaveBeenCalledWith(prisma, 'user-abc')
    expect(detectOpportunities).toHaveBeenCalledWith(prisma, 'user-abc')
    expect(result).toEqual({ processed: 1, errors: 0 })
  })
})

describe('job: detect-opportunities — all users', () => {
  beforeEach(() => vi.clearAllMocks())

  it('processes all bank-linked users', async () => {
    const prisma = makePrisma({ bankUsers: [{ id: 'u1' }, { id: 'u2' }] })
    const handler = captureHandler(prisma)
    await handler(makeJob('detect-opportunities'))
    expect(detectRecurringPayments).toHaveBeenCalledTimes(2)
  })

  it('also processes no-bank users for no_bank_profile detection', async () => {
    const prisma = makePrisma({
      bankUsers: [{ id: 'u1' }],
      noBankUsers: [{ id: 'u2' }],
    })
    const handler = captureHandler(prisma)
    await handler(makeJob('detect-opportunities'))
    // detectOpportunities called for bank user + no-bank user
    expect(detectOpportunities).toHaveBeenCalledTimes(2)
  })

  it('returns processed count = bank + no-bank users', async () => {
    const prisma = makePrisma({
      bankUsers: [{ id: 'u1' }, { id: 'u2' }],
      noBankUsers: [{ id: 'u3' }],
    })
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('detect-opportunities')) as { processed: number; errors: number }
    expect(result.processed).toBe(3)
  })

  it('isolates errors — increments errors count but continues processing remaining users', async () => {
    vi.mocked(detectRecurringPayments).mockRejectedValueOnce(new Error('timeout'))
    const prisma = makePrisma({ bankUsers: [{ id: 'u1' }, { id: 'u2' }] })
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('detect-opportunities')) as { errors: number }
    expect(result.errors).toBe(1)
    // Second user still processed despite first failing
    expect(detectRecurringPayments).toHaveBeenCalledTimes(2)
  })
})

describe('job: deliver-opportunities', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delivers to a specific user when userId provided', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('deliver-opportunities', { userId: 'user-xyz' }))
    expect(deliverOpportunitiesToUser).toHaveBeenCalledWith(prisma, 'user-xyz')
    expect(result).toEqual({ processed: 1, errors: 0 })
  })

  it('runs batch delivery when no userId provided', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    await handler(makeJob('deliver-opportunities'))
    expect(runDeliveryBatch).toHaveBeenCalledOnce()
  })
})

describe('job: expire-offers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls expireStaleOffers and returns the count as processed', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('expire-offers'))
    expect(expireStaleOffers).toHaveBeenCalledWith(prisma)
    expect(result).toEqual({ processed: 3, errors: 0 })
  })
})

describe('job: reconcile-commissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls reconcileCommissions and maps checked to processed', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('reconcile-commissions')) as { processed: number; errors: number }
    expect(reconcileCommissions).toHaveBeenCalledWith(prisma)
    expect(result.processed).toBe(5)
    expect(result.errors).toBe(0)
  })
})

describe('job: monthly-aggregation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls runMonthlyAggregationBatch and maps aggregated to processed', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('monthly-aggregation')) as { processed: number; errors: number }
    expect(runMonthlyAggregationBatch).toHaveBeenCalledWith(prisma)
    expect(result.processed).toBe(7)
    expect(result.errors).toBe(0)
  })
})

describe('job: anomaly-scoring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls runAnomalyScoreBatch and maps scored to processed', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('anomaly-scoring')) as { processed: number; errors: number }
    expect(runAnomalyScoreBatch).toHaveBeenCalledWith(prisma)
    expect(result.processed).toBe(12)
    expect(result.errors).toBe(0)
  })
})

describe('job: anomaly-alerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls runAnomalyAlertBatch and maps alerted to processed', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    const result = await handler(makeJob('anomaly-alerts')) as { processed: number; errors: number }
    expect(runAnomalyAlertBatch).toHaveBeenCalledWith(prisma)
    expect(result.processed).toBe(3)
    expect(result.errors).toBe(0)
  })
})

describe('job: unknown type', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws for unrecognised job names', async () => {
    const prisma = makePrisma()
    const handler = captureHandler(prisma)
    await expect(handler(makeJob('do-something-weird'))).rejects.toThrow('Unknown job type')
  })
})
