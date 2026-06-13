import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { parseCsv, importOffersFromCsv } from '../offerImportService.js'

vi.mock('../offerUpsertService.js', () => ({
  upsertOffer: vi.fn().mockResolvedValue({ action: 'created', id: 'offer-1' }),
}))

import { upsertOffer } from '../offerUpsertService.js'

const VALID_ROW = [
  'Acme Bank', 'acme-bank', 'savings', 'Acme Savings Account',
  'A great savings account', 'awin', 'PROG123', 'https://acme.com',
  'cpa', '25', 'false', 'High rates|FSCS protected', '', '', '',
].join(',')

const HEADER = [
  'providerName', 'providerSlug', 'categorySlug', 'title', 'shortDescription',
  'affiliateNetwork', 'affiliateProgramId', 'affiliateBaseUrl',
  'commissionType', 'commissionValue', 'requiresBankLink',
  'keyBenefits', 'targetMerchantSlugs', 'targetCategories', 'keyTerms',
].join(',')

function makePrisma(): PrismaClient {
  return {
    offerIngestionRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('parseCsv', () => {
  it('returns empty when fewer than 2 lines', () => {
    expect(parseCsv('').headers).toHaveLength(0)
    expect(parseCsv('providerName').headers).toHaveLength(0)
  })

  it('parses header and rows', () => {
    const csv = `${HEADER}\n${VALID_ROW}`
    const { headers, rows } = parseCsv(csv)
    expect(headers[0]).toBe('providerName')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.[0]).toBe('Acme Bank')
  })

  it('handles CRLF line endings', () => {
    const csv = `${HEADER}\r\n${VALID_ROW}`
    const { rows } = parseCsv(csv)
    expect(rows).toHaveLength(1)
  })

  it('strips quotes from cells', () => {
    const csv = `providerName,title\n"Acme","My Offer"`
    const { rows } = parseCsv(csv)
    expect(rows[0]?.[0]).toBe('Acme')
    expect(rows[0]?.[1]).toBe('My Offer')
  })
})

describe('importOffersFromCsv', () => {
  let prisma: PrismaClient

  beforeEach(() => {
    vi.clearAllMocks()
    prisma = makePrisma()
  })

  it('creates ingestion run and returns result', async () => {
    const csv = `${HEADER}\n${VALID_ROW}`
    const result = await importOffersFromCsv(prisma, csv, 'admin')

    expect(prisma.offerIngestionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'csv_upload', status: 'running', triggeredBy: 'admin' }) }),
    )
    expect(result.runId).toBe('run-1')
    expect(result.total).toBe(1)
    expect(result.created).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('returns error when required column missing from header', async () => {
    const csv = `providerName,title\nAcme,My Offer`
    const result = await importOffersFromCsv(prisma, csv)

    expect(result.errors[0]?.message).toMatch(/Missing required columns/)
    expect(prisma.offerIngestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    )
  })

  it('skips row with invalid affiliateNetwork', async () => {
    const badRow = VALID_ROW.replace(',awin,', ',badnetwork,')
    const csv = `${HEADER}\n${badRow}`
    const result = await importOffersFromCsv(prisma, csv)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toMatch(/Invalid affiliateNetwork/)
    expect(result.skipped).toBe(0)
    expect(result.created).toBe(0)
  })

  it('skips row with invalid commissionType', async () => {
    const badRow = VALID_ROW.replace(',cpa,', ',unknown,')
    const csv = `${HEADER}\n${badRow}`
    const result = await importOffersFromCsv(prisma, csv)

    expect(result.errors[0]?.message).toMatch(/Invalid commissionType/)
  })

  it('skips row with invalid commissionValue', async () => {
    const cells = VALID_ROW.split(',')
    cells[9] = 'notanumber'
    const csv = `${HEADER}\n${cells.join(',')}`
    const result = await importOffersFromCsv(prisma, csv)

    expect(result.errors[0]?.message).toMatch(/Invalid commissionValue/)
  })

  it('counts updated when upsertOffer returns updated', async () => {
    vi.mocked(upsertOffer).mockResolvedValueOnce({ action: 'updated', id: 'offer-1' })
    const csv = `${HEADER}\n${VALID_ROW}`
    const result = await importOffersFromCsv(prisma, csv)

    expect(result.updated).toBe(1)
    expect(result.created).toBe(0)
  })

  it('records error when upsertOffer throws', async () => {
    vi.mocked(upsertOffer).mockRejectedValueOnce(new Error('DB failure'))
    const csv = `${HEADER}\n${VALID_ROW}`
    const result = await importOffersFromCsv(prisma, csv)

    expect(result.errors[0]?.message).toBe('DB failure')
    expect(result.created).toBe(0)
  })

  it('marks run as failed when all rows error', async () => {
    vi.mocked(upsertOffer).mockRejectedValueOnce(new Error('oops'))
    const csv = `${HEADER}\n${VALID_ROW}`
    await importOffersFromCsv(prisma, csv)

    expect(prisma.offerIngestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    )
  })

  it('marks run as completed when at least one row succeeds', async () => {
    const csv = `${HEADER}\n${VALID_ROW}\n${VALID_ROW}`
    vi.mocked(upsertOffer)
      .mockResolvedValueOnce({ action: 'created', id: 'offer-1' })
      .mockRejectedValueOnce(new Error('oops'))
    await importOffersFromCsv(prisma, csv)

    expect(prisma.offerIngestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    )
  })

  it('parses pipe-separated keyBenefits', async () => {
    const csv = `${HEADER}\n${VALID_ROW}`
    await importOffersFromCsv(prisma, csv)

    expect(upsertOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keyBenefits: ['High rates', 'FSCS protected'] }),
    )
  })

  it('parses pipe-separated keyTerms, targetMerchantSlugs, and targetCategories when present', async () => {
    const cells = VALID_ROW.split(',')
    // keyTerms is index 14, targetMerchantSlugs is 12, targetCategories is 13
    cells[14] = 'T&Cs apply|Min deposit £1'
    cells[12] = 'acme-merchant|other-merchant'
    cells[13] = 'savings|investments'
    const csv = `${HEADER}\n${cells.join(',')}`
    await importOffersFromCsv(prisma, csv)

    expect(upsertOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        keyTerms: ['T&Cs apply', 'Min deposit £1'],
        targetMerchantSlugs: ['acme-merchant', 'other-merchant'],
        targetCategories: ['savings', 'investments'],
      }),
    )
  })

  it('counts skipped when upsertOffer returns skipped', async () => {
    vi.mocked(upsertOffer).mockResolvedValueOnce({ action: 'skipped', id: 'offer-1' })
    const csv = `${HEADER}\n${VALID_ROW}`
    const result = await importOffersFromCsv(prisma, csv)

    expect(result.skipped).toBe(1)
    expect(result.created).toBe(0)
    expect(result.updated).toBe(0)
  })
})
