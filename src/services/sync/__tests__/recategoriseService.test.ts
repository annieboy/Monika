import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { recategoriseExistingTransactions } from '../recategoriseService.js'

function makePrisma(rows: unknown[]): { prisma: PrismaClient; updateMany: ReturnType<typeof vi.fn> } {
  const updateMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
    count: where.id.in.length,
  }))
  const prisma = {
    transaction: {
      findMany: vi.fn(async () => rows),
      updateMany,
    },
  } as unknown as PrismaClient
  return { prisma, updateMany }
}

describe('recategoriseExistingTransactions', () => {
  it('re-categorises resolvable rows and reports the count', async () => {
    const { prisma, updateMany } = makePrisma([
      { id: 't1', merchantNameClean: 'Tesco', merchantName: 'Tesco', rawDescription: null, cleanDescription: null, merchantCategoryCode: null },
      { id: 't2', merchantNameClean: null, merchantName: null, rawDescription: 'CARD PAYMENT TO NANDOS 10', cleanDescription: null, merchantCategoryCode: null },
      { id: 't3', merchantNameClean: null, merchantName: null, rawDescription: 'random ref 55', cleanDescription: null, merchantCategoryCode: '5411' },
    ])
    const updated = await recategoriseExistingTransactions(prisma, 'user-1')
    expect(updated).toBe(3)
    // One updateMany per distinct resolved category (groceries x2, restaurants x1)
    const cats = updateMany.mock.calls.map(c => c[0].data.category).sort()
    expect(cats).toEqual(['groceries', 'restaurants'])
  })

  it('skips rows that still cannot be resolved', async () => {
    const { prisma, updateMany } = makePrisma([
      { id: 't1', merchantNameClean: 'UNKNOWN XYZ', merchantName: null, rawDescription: 'ref 1', cleanDescription: null, merchantCategoryCode: '9999' },
    ])
    const updated = await recategoriseExistingTransactions(prisma, 'user-1')
    expect(updated).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('does nothing when there are no uncategorised rows', async () => {
    const { prisma, updateMany } = makePrisma([])
    const updated = await recategoriseExistingTransactions(prisma, 'user-1')
    expect(updated).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })
})
