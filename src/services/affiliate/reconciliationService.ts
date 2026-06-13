/**
 * Commission reconciliation service.
 *
 * Queries affiliate network APIs to check the current status of pending
 * commissions and updates AffiliateClick records accordingly.
 *
 * Networks supported: Awin, CJ, Impact.
 * For 'direct' network offers, commissions are set by postback only.
 *
 * Called by the reconciliation worker (nightly) and can also be triggered
 * manually via the admin API.
 */
import type { PrismaClient } from '@prisma/client'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

export interface ReconciliationResult {
  checked: number
  updated: number
  errors: number
}

// ── Awin API ────────────────────────────────────────────────────────────────

async function reconcileAwin(
  prisma: PrismaClient,
  clickRefs: string[],
): Promise<Map<string, string>> {
  if (!config.AWIN_API_KEY || !config.AWIN_PUBLISHER_ID) return new Map()

  const updates = new Map<string, string>()

  try {
    const url = `https://api.awin.com/publishers/${config.AWIN_PUBLISHER_ID}/transactions/?clickRefs=${clickRefs.join(',')}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.AWIN_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Awin reconciliation API error')
      return updates
    }

    const data = await res.json() as { clickRef: string; commissionStatus: string }[]
    for (const txn of data) {
      const status = mapAwinStatus(txn.commissionStatus)
      if (status) updates.set(txn.clickRef, status)
    }
  } catch (err) {
    logger.error({ err }, 'Awin reconciliation fetch failed')
  }

  return updates
}

function mapAwinStatus(awinStatus: string): string | null {
  switch (awinStatus?.toLowerCase()) {
    case 'approved': return 'APPROVED'
    case 'pending':  return 'PENDING'
    case 'declined': return 'REJECTED'
    case 'deleted':  return 'REVERSED'
    default: return null
  }
}

// ── CJ API ──────────────────────────────────────────────────────────────────

async function reconcileCJ(
  prisma: PrismaClient,
  clickRefs: string[],
): Promise<Map<string, string>> {
  if (!config.CJ_API_KEY || !config.CJ_PUBLISHER_ID) return new Map()

  const updates = new Map<string, string>()

  try {
    const params = new URLSearchParams({
      'website-id': config.CJ_PUBLISHER_ID,
      'date-type': 'event',
      'start-date': new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
      'end-date': new Date().toISOString().slice(0, 10),
      'sid': clickRefs.join(','),
    })
    const url = `https://commissions.api.cj.com/query?${params}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.CJ_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      logger.warn({ status: res.status }, 'CJ reconciliation API error')
      return updates
    }

    const data = await res.json() as { sid: string; commissionStatus: string }[]
    for (const txn of data) {
      const status = mapCJStatus(txn.commissionStatus)
      if (status) updates.set(txn.sid, status)
    }
  } catch (err) {
    logger.error({ err }, 'CJ reconciliation fetch failed')
  }

  return updates
}

function mapCJStatus(cjStatus: string): string | null {
  switch (cjStatus?.toLowerCase()) {
    case 'approved':  return 'APPROVED'
    case 'new':       return 'PENDING'
    case 'extended':  return 'PENDING'
    case 'returned':  return 'REJECTED'
    case 'corrected': return 'REVERSED'
    default: return null
  }
}

// ── Impact API ──────────────────────────────────────────────────────────────

async function reconcileImpact(
  prisma: PrismaClient,
  clickRefs: string[],
): Promise<Map<string, string>> {
  if (!config.IMPACT_ACCOUNT_SID || !config.IMPACT_AUTH_TOKEN) return new Map()

  const updates = new Map<string, string>()

  try {
    const credentials = Buffer.from(`${config.IMPACT_ACCOUNT_SID}:${config.IMPACT_AUTH_TOKEN}`).toString('base64')
    const params = new URLSearchParams({ SubId1: clickRefs.join(',') })
    const url = `https://api.impact.com/Affiliates/${config.IMPACT_ACCOUNT_SID}/Actions?${params}`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Impact reconciliation API error')
      return updates
    }

    const data = await res.json() as { SubId1: string; ActionStatus: string }[]
    for (const txn of data) {
      const status = mapImpactStatus(txn.ActionStatus)
      if (status) updates.set(txn.SubId1, status)
    }
  } catch (err) {
    logger.error({ err }, 'Impact reconciliation fetch failed')
  }

  return updates
}

function mapImpactStatus(impactStatus: string): string | null {
  switch (impactStatus?.toLowerCase()) {
    case 'approved':  return 'APPROVED'
    case 'pending':   return 'PENDING'
    case 'rejected':  return 'REJECTED'
    case 'reversed':  return 'REVERSED'
    default: return null
  }
}

// ── Main reconciliation function ─────────────────────────────────────────────

export async function reconcileCommissions(prisma: PrismaClient): Promise<ReconciliationResult> {
  // Load all clicks that are PENDING or VALIDATED (not yet APPROVED/PAID/REJECTED/REVERSED)
  const pendingClicks = await prisma.affiliateClick.findMany({
    where: {
      commissionStatus: { in: ['PENDING', 'VALIDATED'] },
      clickedAt: { gte: new Date(Date.now() - 90 * 86_400_000) }, // max 90-day lookback
    },
    select: {
      id: true,
      clickRef: true,
      affiliateNetwork: true,
      commissionStatus: true,
    },
  })

  if (pendingClicks.length === 0) return { checked: 0, updated: 0, errors: 0 }

  logger.info({ count: pendingClicks.length }, 'Starting commission reconciliation')

  // Group by network
  const byNetwork: Record<string, typeof pendingClicks> = {}
  for (const click of pendingClicks) {
    const net = click.affiliateNetwork
    ;(byNetwork[net] ??= []).push(click)
  }

  const allUpdates = new Map<string, string>()
  let errors = 0

  // Fetch from each network API
  try {
    const awinClicks = byNetwork['awin'] ?? []
    if (awinClicks.length > 0) {
      const updates = await reconcileAwin(prisma, awinClicks.map(c => c.clickRef))
      updates.forEach((status, ref) => allUpdates.set(ref, status))
    }
  } catch { errors++ }

  try {
    const cjClicks = byNetwork['cj'] ?? []
    if (cjClicks.length > 0) {
      const updates = await reconcileCJ(prisma, cjClicks.map(c => c.clickRef))
      updates.forEach((status, ref) => allUpdates.set(ref, status))
    }
  } catch { errors++ }

  try {
    const impactClicks = byNetwork['impact'] ?? []
    if (impactClicks.length > 0) {
      const updates = await reconcileImpact(prisma, impactClicks.map(c => c.clickRef))
      updates.forEach((status, ref) => allUpdates.set(ref, status))
    }
  } catch { errors++ }

  // Apply updates
  let updated = 0
  for (const click of pendingClicks) {
    const newStatus = allUpdates.get(click.clickRef)
    if (!newStatus || newStatus === click.commissionStatus) continue

    try {
      await prisma.affiliateClick.update({
        where: { id: click.id },
        data: {
          commissionStatus: newStatus as 'APPROVED' | 'PENDING' | 'REJECTED' | 'REVERSED',
          ...(newStatus === 'APPROVED' ? { commissionLockedAt: new Date() } : {}),
        },
      })
      updated++
    } catch (err) {
      logger.error({ err, clickId: click.id }, 'Failed to update commission status')
      errors++
    }
  }

  logger.info({ checked: pendingClicks.length, updated, errors }, 'Commission reconciliation complete')
  return { checked: pendingClicks.length, updated, errors }
}
