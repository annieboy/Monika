import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined)
const mockQueue = { upsertJobScheduler: mockUpsertJobScheduler, add: vi.fn() }

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () { return mockQueue }),
}))

vi.mock('../connection.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue('redis://localhost:6379'),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getOpportunityQueue: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let scheduleRecurringJobs: any

beforeAll(async () => {
  const mod = await import('../opportunityQueue.js')
  getOpportunityQueue = mod.getOpportunityQueue
  scheduleRecurringJobs = mod.scheduleRecurringJobs
})

describe('getOpportunityQueue', () => {
  beforeEach(() => {
    mockUpsertJobScheduler.mockClear()
  })

  it('returns a Queue instance', () => {
    const queue = getOpportunityQueue()
    expect(queue).toBe(mockQueue)
  })

  it('returns the same instance on subsequent calls (singleton)', () => {
    const q1 = getOpportunityQueue()
    const q2 = getOpportunityQueue()
    expect(q1).toBe(q2)
  })
})

describe('scheduleRecurringJobs', () => {
  beforeEach(() => {
    mockUpsertJobScheduler.mockClear()
  })

  it('calls upsertJobScheduler exactly four times', async () => {
    await scheduleRecurringJobs()
    expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(4)
  })

  it('schedules detect-opportunities with cron 0 9 * * *', async () => {
    await scheduleRecurringJobs()
    expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
      'daily-detect',
      expect.objectContaining({ pattern: '0 9 * * *' }),
      expect.objectContaining({ name: 'detect-opportunities' }),
    )
  })

  it('schedules reconcile-commissions job', async () => {
    await scheduleRecurringJobs()
    expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
      'nightly-reconcile',
      expect.objectContaining({ pattern: '0 3 * * *' }),
      expect.objectContaining({ name: 'reconcile-commissions' }),
    )
  })
})
