/**
 * Re-categorisation backfill.
 *
 * Transactions are categorised at import time, but two things leave rows in the
 * "other"/uncategorised bucket: an earlier, weaker categoriser, and the fact
 * that re-syncing skips rows that already exist (so a better categoriser never
 * reaches them). This recomputes the category for a user's uncategorised debits
 * from the fields we already store (merchant name, description, MCC) and updates
 * the ones that now resolve — so a "refresh" or the next scheduled sync tidies
 * historical data without re-importing anything.
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { inferCategory } from '../analytics/categorise.js'
import { logger } from '../../logger.js'

/** Categories that mean "we don't really know" and are worth recomputing. */
const UNRESOLVED = [null, 'other', 'general', 'uncategorised', 'uncategorized']

export async function recategoriseExistingTransactions(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      amount: { lt: 0 }, // spending only; income/transfers aren't "spend categories"
      isInternalTransfer: false,
      OR: [
        { category: null },
        { category: { in: UNRESOLVED.filter((c): c is string => c !== null) } },
      ],
    },
    select: {
      id: true,
      merchantName: true,
      merchantNameClean: true,
      rawDescription: true,
      cleanDescription: true,
      merchantCategoryCode: true,
    },
  })

  if (rows.length === 0) return 0

  // Resolve each row, then group by the new category so we issue one updateMany
  // per category instead of one update per row.
  const byCategory = new Map<string, string[]>()
  for (const r of rows) {
    const category = inferCategory({
      merchantName: r.merchantNameClean ?? r.merchantName,
      description: r.cleanDescription ?? r.rawDescription,
      mcc: r.merchantCategoryCode,
    })
    if (!category) continue
    const ids = byCategory.get(category) ?? []
    ids.push(r.id)
    byCategory.set(category, ids)
  }

  let updated = 0
  for (const [category, ids] of byCategory) {
    const res = await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { category, categoryMethod: 'rule', categoryConfidence: new Decimal('0.800') },
    })
    updated += res.count
  }

  if (updated > 0) {
    logger.info({ userId, updated, scanned: rows.length }, 'Re-categorised existing transactions')
  }
  return updated
}
