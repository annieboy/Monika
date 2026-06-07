import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { processStatusUpdate } from '../status.js'
import type { ParsedStatusUpdate } from '../../../types/whatsapp.js'

function makeUpdate(overrides: Partial<ParsedStatusUpdate> = {}): ParsedStatusUpdate {
  return {
    waMessageId: 'wamid.out123',
    status: 'delivered',
    timestamp: new Date(),
    recipientPhone: '447700900001',
    ...overrides,
  }
}

function makePrisma(conversation: { id: string; waStatus: string | null } | null) {
  return {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(conversation),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('processStatusUpdate', () => {
  it('updates wa_status when conversation found and status advances', async () => {
    const prisma = makePrisma({ id: 'conv-1', waStatus: 'sent' })

    await processStatusUpdate(prisma, makeUpdate({ status: 'delivered' }))

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { waStatus: 'delivered' },
    })
  })

  it('does nothing when conversation not found', async () => {
    const prisma = makePrisma(null)

    await processStatusUpdate(prisma, makeUpdate())

    expect(prisma.conversation.update).not.toHaveBeenCalled()
  })

  it('does not regress status from delivered back to sent', async () => {
    const prisma = makePrisma({ id: 'conv-1', waStatus: 'delivered' })

    await processStatusUpdate(prisma, makeUpdate({ status: 'sent' }))

    expect(prisma.conversation.update).not.toHaveBeenCalled()
  })

  it('does not regress status from read to delivered', async () => {
    const prisma = makePrisma({ id: 'conv-1', waStatus: 'read' })

    await processStatusUpdate(prisma, makeUpdate({ status: 'delivered' }))

    expect(prisma.conversation.update).not.toHaveBeenCalled()
  })

  it('advances status from delivered to read', async () => {
    const prisma = makePrisma({ id: 'conv-1', waStatus: 'delivered' })

    await processStatusUpdate(prisma, makeUpdate({ status: 'read' }))

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { waStatus: 'read' },
    })
  })

  it('stores failed status even from sent', async () => {
    const prisma = makePrisma({ id: 'conv-1', waStatus: 'sent' })

    await processStatusUpdate(prisma, makeUpdate({ status: 'failed' }))

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { waStatus: 'failed' },
    })
  })

  it('updates from null waStatus to sent', async () => {
    const prisma = makePrisma({ id: 'conv-1', waStatus: null })

    await processStatusUpdate(prisma, makeUpdate({ status: 'sent' }))

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { waStatus: 'sent' },
    })
  })
})
