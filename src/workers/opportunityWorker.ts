/**
 * Opportunity Engine worker.
 *
 * Processes three job types from the opportunity-engine queue:
 *   detect-opportunities  — runs recurringPaymentDetector + opportunityDetector for user(s)
 *   deliver-opportunities — runs opportunityDeliveryService for user(s)
 *   expire-offers         — marks stale offers inactive
 *
 * Each job type is idempotent and safe to retry.
 */
import { Worker, type Job } from 'bullmq'
import type { PrismaClient } from '@prisma/client'
import { detectRecurringPayments } from '../services/opportunity/recurringPaymentDetector.js'
import { detectOpportunities } from '../services/opportunity/opportunityDetector.js'
import { deliverOpportunitiesToUser, runDeliveryBatch } from '../services/opportunity/opportunityDeliveryService.js'
import { expireStaleOffers } from '../services/offers/offerUpsertService.js'
import { reconcileCommissions } from '../services/affiliate/reconciliationService.js'
import { runBillReminderBatch } from '../services/reminders/billReminderService.js'
import { runGoalProgressBatch } from '../services/notifications/goalProgressService.js'
import { runWeeklyDigestBatch } from '../services/notifications/weeklyDigestService.js'
import { runExpiryNudgeBatch } from '../services/notifications/expiryNudgeService.js'
import { pruneOldSessions } from '../services/conversation/sessionService.js'
import { runSpendingTrendAlertBatch } from '../services/analytics/spendingTrendService.js'
import { runReconnectNudgeBatch } from '../services/banking/reconnectNudgeService.js'
import { runBudgetAlertBatch } from '../services/budget/budgetAlertService.js'
import { runMonthlyAggregationBatch } from '../services/analytics/monthlyAggregationService.js'
import { runAnomalyScoreBatch } from '../services/analytics/anomalyScoreService.js'
import { runAnomalyAlertBatch } from '../services/analytics/anomalyAlertService.js'
import { runPriceChangeAlertBatch } from '../services/notifications/priceChangeAlertService.js'
import { runLowBalanceAlertBatch } from '../services/notifications/lowBalanceAlertService.js'
import { runSubscriptionAuditBatch } from '../services/notifications/subscriptionAuditService.js'
import { runDebtMilestoneBatch } from '../services/notifications/debtMilestoneService.js'
import { runInactivityNudgeBatch } from '../services/notifications/inactivityNudgeService.js'
import { createRedisConnection } from '../queues/connection.js'
import { OPPORTUNITY_QUEUE, type OpportunityJobName } from '../queues/opportunityQueue.js'
import { logger } from '../logger.js'

export interface WorkerResult {
  processed: number
  errors: number
}

async function handleDetect(prisma: PrismaClient, userId?: string): Promise<WorkerResult> {
  if (userId) {
    await detectRecurringPayments(prisma, userId)
    await detectOpportunities(prisma, userId)
    return { processed: 1, errors: 0 }
  }

  // All users with active bank connections
  const users = await prisma.user.findMany({
    where: { bankConnections: { some: { consentStatus: 'active' } } },
    select: { id: true },
  })

  let errors = 0
  for (const user of users) {
    try {
      await detectRecurringPayments(prisma, user.id)
      await detectOpportunities(prisma, user.id)
    } catch (err) {
      errors++
      logger.error({ err, userId: user.id }, 'Detection failed for user')
    }
  }

  // Also surface no-bank offers for users without a connection
  const noBankUsers = await prisma.user.findMany({
    where: { bankConnections: { none: {} } },
    select: { id: true },
  })
  for (const user of noBankUsers) {
    try {
      await detectOpportunities(prisma, user.id)
    } catch (err) {
      errors++
      logger.error({ err, userId: user.id }, 'No-bank detection failed for user')
    }
  }

  return { processed: users.length + noBankUsers.length, errors }
}

async function handleDeliver(prisma: PrismaClient, userId?: string): Promise<WorkerResult> {
  if (userId) {
    await deliverOpportunitiesToUser(prisma, userId)
    return { processed: 1, errors: 0 }
  }
  await runDeliveryBatch(prisma, logger)
  return { processed: -1, errors: 0 } // batch handles its own counting
}

async function handleExpire(prisma: PrismaClient): Promise<WorkerResult> {
  const count = await expireStaleOffers(prisma)
  return { processed: count, errors: 0 }
}

export function startOpportunityWorker(prisma: PrismaClient): Worker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worker = new Worker<any, WorkerResult, string>(
    OPPORTUNITY_QUEUE,
    async (job: Job) => {
      logger.info({ jobId: job.id, name: job.name }, 'Processing opportunity job')
      const name = job.name as OpportunityJobName

      switch (name) {
        case 'detect-opportunities':
          return handleDetect(prisma, (job.data as { userId?: string }).userId)

        case 'deliver-opportunities':
          return handleDeliver(prisma, (job.data as { userId?: string }).userId)

        case 'bill-reminders': {
          const result = await runBillReminderBatch(prisma)
          return { processed: result.reminded, errors: result.errors }
        }

        case 'expire-offers':
          return handleExpire(prisma)

        case 'reconcile-commissions': {
          const result = await reconcileCommissions(prisma)
          return { processed: result.checked, errors: result.errors }
        }

        case 'goal-progress-check': {
          const result = await runGoalProgressBatch(prisma)
          return { processed: result.notified, errors: result.errors }
        }

        case 'weekly-digest': {
          const result = await runWeeklyDigestBatch(prisma)
          return { processed: result.sent, errors: result.errors }
        }

        case 'expiry-nudge': {
          const result = await runExpiryNudgeBatch(prisma)
          return { processed: result.nudged, errors: result.errors }
        }

        case 'prune-sessions': {
          const result = await pruneOldSessions(prisma)
          return { processed: result.deleted, errors: 0 }
        }

        case 'spending-trend-alerts': {
          const result = await runSpendingTrendAlertBatch(prisma)
          return { processed: result.notified, errors: result.errors }
        }

        case 'reconnect-nudge': {
          const result = await runReconnectNudgeBatch(prisma)
          return { processed: result.nudged, errors: result.errors }
        }

        case 'budget-alerts': {
          const result = await runBudgetAlertBatch(prisma)
          return { processed: result.alerted, errors: result.errors }
        }

        case 'monthly-aggregation': {
          const result = await runMonthlyAggregationBatch(prisma)
          return { processed: result.aggregated, errors: result.errors }
        }

        case 'anomaly-scoring': {
          const result = await runAnomalyScoreBatch(prisma)
          return { processed: result.scored, errors: result.errors }
        }

        case 'anomaly-alerts': {
          const result = await runAnomalyAlertBatch(prisma)
          return { processed: result.alerted, errors: result.errors }
        }

        case 'price-change-alerts': {
          const result = await runPriceChangeAlertBatch(prisma)
          return { processed: result.processed, errors: result.errors }
        }

        case 'low-balance-alerts': {
          const result = await runLowBalanceAlertBatch(prisma)
          return { processed: result.processed, errors: result.errors }
        }

        case 'subscription-audit': {
          const result = await runSubscriptionAuditBatch(prisma)
          return { processed: result.processed, errors: result.errors }
        }

        case 'debt-milestones': {
          const result = await runDebtMilestoneBatch(prisma)
          return { processed: result.processed, errors: result.errors }
        }

        case 'inactivity-nudge': {
          const result = await runInactivityNudgeBatch(prisma)
          return { processed: result.processed, errors: result.errors }
        }

        default: {
          throw new Error(`Unknown job type: ${String(job.name)}`)
        }
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 2,
      limiter: { max: 10, duration: 1000 },
    },
  )

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, name: job.name, result }, 'Opportunity job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'Opportunity job failed')
  })

  worker.on('error', (err) => {
    logger.error({ err }, 'Opportunity worker error')
  })

  return worker
}
