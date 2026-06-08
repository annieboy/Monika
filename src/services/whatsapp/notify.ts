/**
 * Post-connect WhatsApp notification.
 *
 * After a user links their bank (either via TrueLayer OAuth or the mock flow),
 * this sends them a WhatsApp message confirming it worked and prompting them
 * to ask their first question.
 */
import type { PrismaClient } from '@prisma/client'
import { decrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from './sender.js'
import { config } from '../../config.js'

export async function sendBankConnectedNotification(
  prisma: PrismaClient,
  userId: string,
  syncResult: { accountsSynced: number; transactionsImported: number },
): Promise<void> {
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = config.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) return

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappPhoneEnc: true },
  })
  if (!user?.whatsappPhoneEnc) return

  let phone: string
  try {
    phone = decrypt(Buffer.from(user.whatsappPhoneEnc), config.ENCRYPTION_KEY).toString('utf-8')
  } catch {
    return
  }

  const { accountsSynced, transactionsImported } = syncResult
  const acctLine = accountsSynced === 1 ? '1 account' : `${accountsSynced} accounts`
  const txnLine =
    transactionsImported === 1
      ? '1 transaction'
      : `${transactionsImported} transactions`

  const message =
    `✅ Your bank is connected!\n\n` +
    `I've imported ${acctLine} and ${txnLine}.\n\n` +
    `You can now ask me things like:\n` +
    `• "How much did I spend this month?"\n` +
    `• "What subscriptions am I paying for?"\n` +
    `• "What's my balance?"`

  await sendWhatsAppMessage(phone, message, phoneNumberId, accessToken)
}
