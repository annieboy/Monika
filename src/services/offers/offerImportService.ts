/**
 * Bulk offer import from CSV.
 *
 * Parses and validates each row, upserts via offerUpsertService, and records
 * the run in OfferIngestionRun for audit trail and admin visibility.
 *
 * CSV format (header row required):
 *   providerName, providerSlug, categorySlug, title, shortDescription,
 *   affiliateNetwork, affiliateProgramId, affiliateBaseUrl,
 *   commissionType, commissionValue, requiresBankLink,
 *   keyBenefits (pipe-separated), targetMerchantSlugs (pipe-separated)
 */
import type { PrismaClient } from '@prisma/client'
import { upsertOffer, type OfferInput } from './offerUpsertService.js'
import { logger } from '../../logger.js'

export interface ImportResult {
  runId: string
  total: number
  created: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

const REQUIRED_COLUMNS = [
  'providerName', 'providerSlug', 'categorySlug', 'title', 'shortDescription',
  'affiliateNetwork', 'affiliateProgramId', 'affiliateBaseUrl',
  'commissionType', 'commissionValue',
] as const

const VALID_NETWORKS = new Set(['awin', 'cj', 'impact', 'direct'])
const VALID_COMMISSION_TYPES = new Set(['cpa', 'cpl', 'revenue_share'])

function parseRow(
  headers: string[],
  values: string[],
  _rowIndex: number,
): { input: OfferInput; error?: never } | { input?: never; error: string } {
  const row: Record<string, string> = {}
  for (let i = 0; i < headers.length; i++) {
    row[headers[i] ?? ''] = (values[i] ?? '').trim()
  }

  // Validate required fields
  for (const col of REQUIRED_COLUMNS) {
    if (!row[col]) return { error: `Missing required column: ${col}` }
  }

  const network = row['affiliateNetwork']!.toLowerCase()
  if (!VALID_NETWORKS.has(network)) {
    return { error: `Invalid affiliateNetwork: ${row['affiliateNetwork']} (must be awin|cj|impact|direct)` }
  }

  const commissionType = row['commissionType']!.toLowerCase()
  if (!VALID_COMMISSION_TYPES.has(commissionType)) {
    return { error: `Invalid commissionType: ${row['commissionType']} (must be cpa|cpl|revenue_share)` }
  }

  const commissionValue = parseFloat(row['commissionValue'] ?? '')
  if (isNaN(commissionValue) || commissionValue < 0) {
    return { error: `Invalid commissionValue: must be a non-negative number` }
  }

  const keyBenefits = row['keyBenefits']
    ? row['keyBenefits'].split('|').map(s => s.trim()).filter(Boolean)
    : []

  const keyTerms = row['keyTerms']
    ? row['keyTerms'].split('|').map(s => s.trim()).filter(Boolean)
    : []

  const targetMerchantSlugs = row['targetMerchantSlugs']
    ? row['targetMerchantSlugs'].split('|').map(s => s.trim()).filter(Boolean)
    : []

  const targetCategories = row['targetCategories']
    ? row['targetCategories'].split('|').map(s => s.trim()).filter(Boolean)
    : []

  return {
    input: {
      providerName:        row['providerName']!,
      providerSlug:        row['providerSlug']!,
      categorySlug:        row['categorySlug']!,
      title:               row['title']!,
      shortDescription:    row['shortDescription']!,
      keyBenefits,
      keyTerms,
      parameters:          {},
      affiliateNetwork:    network as OfferInput['affiliateNetwork'],
      affiliateProgramId:  row['affiliateProgramId']!,
      affiliateBaseUrl:    row['affiliateBaseUrl']!,
      commissionType:      commissionType as OfferInput['commissionType'],
      commissionValue,
      targetMerchantSlugs,
      targetCategories,
      requiresBankLink:    row['requiresBankLink'] === 'true',
      isRegulated:         row['isRegulated'] === 'true',
      ...(row['fcaDisclaimer'] ? { fcaDisclaimer: row['fcaDisclaimer'] } : {}),
      ...(row['expiresAt'] ? { expiresAt: new Date(row['expiresAt']) } : {}),
    },
  }
}

export function parseCsv(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const nonEmpty = lines.filter(l => l.trim())
  if (nonEmpty.length < 2) return { headers: [], rows: [] }

  const headers = nonEmpty[0]!.split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = nonEmpty.slice(1).map(line =>
    line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
  )

  return { headers, rows }
}

export async function importOffersFromCsv(
  prisma: PrismaClient,
  csvText: string,
  triggeredBy?: string,
): Promise<ImportResult> {
  // Create ingestion run record
  const run = await prisma.offerIngestionRun.create({
    data: {
      source: 'csv_upload',
      status: 'running',
      ...(triggeredBy ? { triggeredBy } : {}),
    },
  })

  const { headers, rows } = parseCsv(csvText)
  const errors: { row: number; message: string }[] = []

  // Validate headers
  const missingHeaders = REQUIRED_COLUMNS.filter(col => !headers.includes(col))
  if (missingHeaders.length > 0) {
    await prisma.offerIngestionRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorCount: 1,
        errors: [`Missing required columns: ${missingHeaders.join(', ')}`],
      },
    })
    return {
      runId: run.id,
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: `Missing required columns: ${missingHeaders.join(', ')}` }],
    }
  }

  let created = 0
  let updated = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const rowNum = i + 2 // 1-indexed, +1 for header

    const parsed = parseRow(headers, row, rowNum)
    if (parsed.error) {
      errors.push({ row: rowNum, message: parsed.error })
      continue
    }

    try {
      const result = await upsertOffer(prisma, parsed.input!)
      if (result.action === 'created') created++
      else if (result.action === 'updated') updated++
      else skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push({ row: rowNum, message: msg })
      logger.error({ err, rowNum }, 'Failed to upsert offer row')
    }
  }

  const status = errors.length === rows.length && rows.length > 0 ? 'failed' : 'completed'

  await prisma.offerIngestionRun.update({
    where: { id: run.id },
    data: {
      status,
      offersCreated: created,
      offersUpdated: updated,
      offersExpired: 0,
      errorCount: errors.length,
      completedAt: new Date(),
      ...(errors.length > 0 ? { errors: errors as object[] } : {}),
    },
  })

  logger.info(
    { runId: run.id, total: rows.length, created, updated, skipped, errors: errors.length },
    'CSV import complete',
  )

  return { runId: run.id, total: rows.length, created, updated, skipped, errors }
}
