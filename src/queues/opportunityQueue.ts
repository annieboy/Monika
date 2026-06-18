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
  | 'spending-trend-alerts'
  | 'reconnect-nudge'
  | 'budget-alerts'
  | 'monthly-aggregation'
  | 'anomaly-scoring'
  | 'anomaly-alerts'
  | 'price-change-alerts'
  | 'low-balance-alerts'
  | 'subscription-audit'
  | 'debt-milestones'
  | 'inactivity-nudge'

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

  // Every 6 hours — nudge users whose bank connection has been failing for 3+ days
  await queue.upsertJobScheduler(
    'reconnect-nudge',
    { pattern: '0 */6 * * *', tz: 'UTC' },
    {
      name: 'reconnect-nudge',
      data: {},
      opts: { priority: 2 },
    },
  )

  // Daily at 12:00 UTC — budget threshold alerts (80% / 100%)
  await queue.upsertJobScheduler(
    'daily-budget-alerts',
    { pattern: '0 12 * * *', tz: 'UTC' },
    {
      name: 'budget-alerts',
      data: {},
      opts: { priority: 2 },
    },
  )

  // Nightly at 02:30 UTC — pre-compute monthly spend summaries per user
  await queue.upsertJobScheduler(
    'nightly-monthly-aggregation',
    { pattern: '30 2 * * *', tz: 'UTC' },
    {
      name: 'monthly-aggregation',
      data: {},
      opts: { priority: 3 },
    },
  )

  // Every 6 hours — score new transactions for anomalies (runs after sync)
  await queue.upsertJobScheduler(
    'anomaly-scoring',
    { pattern: '0 */6 * * *', tz: 'UTC' },
    {
      name: 'anomaly-scoring',
      data: {},
      opts: { priority: 2 },
    },
  )

  // Daily at 08:30 UTC — send proactive anomaly alerts to users
  await queue.upsertJobScheduler(
    'daily-anomaly-alerts',
    { pattern: '30 8 * * *', tz: 'UTC' },
    {
      name: 'anomaly-alerts',
      data: {},
      opts: { priority: 2 },
    },
  )

  // Monthly on the 5th at 10:00 UTC — alert users about rising spending categories
  await queue.upsertJobScheduler(
    'monthly-spending-trend-alerts',
    { pattern: '0 10 5 * *', tz: 'UTC' },
    {
      name: 'spending-trend-alerts',
      data: {},
      opts: { priority: 3 },
    },
  )

  // Daily at 09:30 UTC — detect recurring payment price increases
  await queue.upsertJobScheduler(
    'daily-price-change-alerts',
    { pattern: '30 9 * * *', tz: 'UTC' },
    {
      name: 'price-change-alerts',
      data: {},
      opts: { priority: 2 },
    },
  )

  // Daily at 07:30 UTC — warn users whose balance dropped below 7 days of spend
  await queue.upsertJobScheduler(
    'daily-low-balance-alerts',
    { pattern: '30 7 * * *', tz: 'UTC' },
    {
      name: 'low-balance-alerts',
      data: {},
      opts: { priority: 1 },
    },
  )

  // Monthly on the 1st at 09:00 UTC — subscription cost digest
  await queue.upsertJobScheduler(
    'monthly-subscription-audit',
    { pattern: '0 9 1 * *', tz: 'UTC' },
    {
      name: 'subscription-audit',
      data: {},
      opts: { priority: 3 },
    },
  )

  // Daily at 11:30 UTC — debt payoff milestone celebrations
  await queue.upsertJobScheduler(
    'daily-debt-milestones',
    { pattern: '30 11 * * *', tz: 'UTC' },
    {
      name: 'debt-milestones',
      data: {},
      opts: { priority: 3 },
    },
  )

  // Weekly on Monday at 10:00 UTC — re-engage users inactive for 30+ days
  await queue.upsertJobScheduler(
    'weekly-inactivity-nudge',
    { pattern: '0 10 * * 1', tz: 'UTC' },
    {
      name: 'inactivity-nudge',
      data: {},
      opts: { priority: 4 },
    },
  )
}
