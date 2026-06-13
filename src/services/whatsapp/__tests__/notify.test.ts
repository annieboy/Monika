/**
 * sendBankConnectedNotification tests.
 *
 * Verifies silent early-return paths (no credentials, no phone, decrypt failure)
 * and the happy path message content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../sender.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid.notify1' }),
}))

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(Buffer.from('447700900001')),
}))

vi.mock('../../../config.js', () => ({
  config: {
    WHATSAPP_PHONE_NUMBER_ID: 'waba-123',
    WHATSAPP_ACCESS_TOKEN: 'token-abc',
    ENCRYPTION_KEY: 'a'.repeat(64),
  },
}))

import { sendBankConnectedNotification } from '../notify.js'
import { sendWhatsAppMessage } from '../sender.js'
import { decrypt } from '../../../lib/crypto.js'

const USER_ID = 'user-00000001'

function makePrisma(phoneEnc: string | null = 'encrypted-phone'): PrismaClient {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(
        phoneEnc !== null ? { whatsappPhoneEnc: Buffer.from('enc') } : null,
      ),
    },
  } as unknown as PrismaClient
}

describe('sendBankConnectedNotification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a message on the happy path', async () => {
    const prisma = makePrisma()
    await sendBankConnectedNotification(prisma, USER_ID, { accountsSynced: 2, transactionsImported: 150 })

    expect(sendWhatsAppMessage).toHaveBeenCalledOnce()
  })

  it('sends to the decrypted phone number', async () => {
    const prisma = makePrisma()
    await sendBankConnectedNotification(prisma, USER_ID, { accountsSynced: 1, transactionsImported: 10 })

    const [phone] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(phone).toBe('447700900001')
  })

  it('message contains account and transaction counts', async () => {
    const prisma = makePrisma()
    await sendBankConnectedNotification(prisma, USER_ID, { accountsSynced: 3, transactionsImported: 250 })

    const [, message] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(message).toContain('3 accounts')
    expect(message).toContain('250 transactions')
  })

  it('uses singular "1 account" and "1 transaction" correctly', async () => {
    const prisma = makePrisma()
    await sendBankConnectedNotification(prisma, USER_ID, { accountsSynced: 1, transactionsImported: 1 })

    const [, message] = (sendWhatsAppMessage as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(message).toContain('1 account')
    expect(message).toContain('1 transaction')
    expect(message).not.toContain('1 accounts')
    expect(message).not.toContain('1 transactions')
  })

  it('returns early without sending when user has no encrypted phone', async () => {
    const prisma = makePrisma(null)
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await sendBankConnectedNotification(prisma, USER_ID, { accountsSynced: 1, transactionsImported: 10 })

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('returns early without sending when decrypt throws', async () => {
    vi.mocked(decrypt).mockImplementationOnce(() => { throw new Error('bad key') })
    const prisma = makePrisma()
    await sendBankConnectedNotification(prisma, USER_ID, { accountsSynced: 1, transactionsImported: 10 })

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('never throws — always resolves', async () => {
    vi.mocked(decrypt).mockImplementationOnce(() => { throw new Error('oops') })
    const prisma = makePrisma()
    await expect(sendBankConnectedNotification(prisma, USER_ID, { accountsSynced: 0, transactionsImported: 0 })).resolves.toBeUndefined()
  })
})
