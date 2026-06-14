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
  | 'bill-reminders'
  | 'expire-offers'
  | 'reconcile-commissions'
  | 'goal-progress-check'
  | 'weekly-digest'
  | 'expiry-nudge'
  | 'prune-sessions'

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

  // Daily at 08:00 UTC — proactive bill due reminders
  await queue.upsertJobScheduler(
    'daily-bill-reminders',
    { pattern: '0 8 * * *', tz: 'UTC' },
    {
      name: 'bill-reminders',
      data: {},
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

  // Nightly at 03:00 UTC — reconcile pending commissions with affiliate networks
  await queue.upsertJobScheduler(
    'nightly-reconcile',
    { pattern: '0 3 * * *', tz: 'UTC' },
    {
      name: 'reconcile-commissions',
      data: {},
      opts: { priority: 3 },
    },
  )

  // Daily at 11:00 UTC — check savings goal progress milestones
  await queue.upsertJobScheduler(
    'daily-goal-progress',
    { pattern: '0 11 * * *', tz: 'UTC' },
    {
      name: 'goal-progress-check',
      data: {},
      opts: { priority: 2 },
    },
  )

  // Weekly on Sunday at 09:30 UTC — send spending digest to active users
  await queue.upsertJobScheduler(
    'weekly-digest',
    { pattern: '30 9 * * 0', tz: 'UTC' },
    {
      name: 'weekly-digest',
      data: {},
      opts: { priority: 3 },
    },
  )

  // Every 6 hours — nudge users about opportunities expiring within 48h
  await queue.upsertJobScheduler(
    'expiry-nudge',
    { pattern: '0 */6 * * *', tz: 'UTC' },
    {
      name: 'expiry-nudge',
      data: {},
      opts: { priority: 3 },
    },
  )

  // Nightly at 01:00 UTC — delete conversation rows older than 90 days
  await queue.upsertJobScheduler(
    'nightly-prune-sessions',
    { pattern: '0 1 * * *', tz: 'UTC' },
    {
      name: 'prune-sessions',
      data: {},
      opts: { priority: 4 },
    },
  )
}
