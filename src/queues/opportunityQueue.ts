/**
 * Opportunity Engine job queue.
 *
 * Jobs:
 *   detect-opportunities  — run detection for one user (or all users)
 *   deliver-opportunities — run delivery batch for one user (or all users)
 *   expire-offers         — mark stale offers inactive (nightly)
 */
import { Queue } from 'bullmq'
import { createRedisConnection } from './connection.js'

export type OpportunityJobName =
  | 'detect-opportunities'
  | 'deliver-opportunities'
  | 'expire-offers'

export interface DetectOpportunitiesData {
  userId?: string   // if omitted, runs for all users
}

export interface DeliverOpportunitiesData {
  userId?: string   // if omitted, runs delivery batch for all eligible users
}

export interface ExpireOffersData {
  _noop?: boolean
}

export type OpportunityJobData =
  | DetectOpportunitiesData
  | DeliverOpportunitiesData
  | ExpireOffersData

export const OPPORTUNITY_QUEUE = 'opportunity-engine'

let _queue: Queue | null = null

export function getOpportunityQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(OPPORTUNITY_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    })
  }
  return _queue
}

export async function scheduleRecurringJobs(): Promise<void> {
  const queue = getOpportunityQueue()

  // Daily at 09:00 UTC — detect new opportunities for all users
  await queue.upsertJobScheduler(
    'daily-detect',
    { pattern: '0 9 * * *', tz: 'UTC' },
    {
      name: 'detect-opportunities',
      data: {} satisfies DetectOpportunitiesData,
      opts: { priority: 2 },
    },
  )

  // Daily at 10:00 UTC — deliver scored opportunities (after detection completes)
  await queue.upsertJobScheduler(
    'daily-deliver',
    { pattern: '0 10 * * *', tz: 'UTC' },
    {
      name: 'deliver-opportunities',
      data: {} satisfies DeliverOpportunitiesData,
      opts: { priority: 2 },
    },
  )

  // Nightly at 02:00 UTC — expire stale offers
  await queue.upsertJobScheduler(
    'nightly-expire',
    { pattern: '0 2 * * *', tz: 'UTC' },
    {
      name: 'expire-offers',
      data: {} satisfies ExpireOffersData,
      opts: { priority: 3 },
    },
  )
}
