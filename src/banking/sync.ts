import type { PrismaClient, Account } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import type { OpenBankingProvider, ProviderConsent, ProviderTransaction } from './types.js'
import { transactionDedupHash } from '../lib/crypto.js'

const SYNC_WINDOW_DAYS = 90

export interface SyncResult {
  accountsSynced: number
  transactionsImported: number
  transactionsSkipped: number
  errors: string[]
}

// ── Account sync ───────────────────────────────────────────────────────────

export async function syncAccounts(
  prisma: PrismaClient,
  connectionId: string,
  userId: string,
  consent: ProviderConsent,
  provider: OpenBankingProvider,
): Promise<Account[]> {
  const providerAccounts = await provider.getAccounts(consent)

  const upserted: Account[] = []
  for (const pa of providerAccounts) {
    const account = await prisma.account.upsert({
      where: { connectionId_providerAccountId: { connectionId, providerAccountId: pa.providerAccountId } },
      create: {
        connectionId,
        userId,
        providerAccountId: pa.providerAccountId,
        accountType: pa.accountType,
        displayName: pa.displayName,
        currency: pa.currency,
        currentBalance: pa.currentBalance,
        availableBalance: pa.availableBalance ?? null,
        accountLast4: pa.accountLast4 ?? null,
        balanceUpdatedAt: new Date(),
      },
      update: {
        displayName: pa.displayName,
        currentBalance: pa.currentBalance,
        availableBalance: pa.availableBalance ?? null,
        balanceUpdatedAt: new Date(),
      },
    })
    upserted.push(account)
  }

  return upserted
}

// ── Transaction sync ───────────────────────────────────────────────────────

export async function syncTransactions(
  prisma: PrismaClient,
  account: Account,
  consent: ProviderConsent,
  provider: OpenBankingProvider,
  from: Date,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const to = new Date()
  const providerTxns = await provider.getTransactions(consent, account.providerAccountId, from, to)

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const pt of providerTxns) {
    try {
      const result = await upsertTransaction(prisma, account, pt)
      if (result === 'created') imported++
      else skipped++
    } catch (err) {
      errors.push(
        `txn ${pt.providerTransactionId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { imported, skipped, errors }
}

async function upsertTransaction(
  prisma: PrismaClient,
  account: Account,
  pt: ProviderTransaction,
): Promise<'created' | 'skipped'> {
  const amountStr = pt.amount.toFixed(2)
  const dedupHash = transactionDedupHash(
    account.id,
    pt.transactionDate,
    amountStr,
    pt.rawDescription,
  )

  // Check by provider ID first (fastest path), then by dedup hash
  const existing = await prisma.transaction.findFirst({
    where: {
      OR: [
        { accountId: account.id, providerTransactionId: pt.providerTransactionId },
        { accountId: account.id, dedupHash },
      ],
    },
    select: { id: true },
  })

  if (existing) return 'skipped'

  await prisma.transaction.create({
    data: {
      accountId: account.id,
      userId: account.userId,
      providerTransactionId: pt.providerTransactionId,
      amount: new Decimal(amountStr),
      currency: pt.currency,
      transactionType: pt.transactionType,
      status: pt.status,
      merchantName: pt.merchantName ?? null,
      merchantNameClean: pt.merchantName ?? null,
      merchantCategoryCode: pt.merchantCategoryCode ?? null,
      transactionDate: pt.transactionDate,
      valueDate: pt.valueDate ?? null,
      rawDescription: pt.rawDescription,
      category: pt.category ?? null,
      isSalary: pt.isSalary ?? false,
      isSubscription: pt.isSubscription ?? false,
      subscriptionName: pt.subscriptionName ?? null,
      isRecurring: pt.isSubscription ?? false,
      dedupHash,
      categoryMethod: pt.category ? 'rule' : null,
      categoryConfidence: pt.category ? new Decimal('0.900') : null,
    },
  })

  return 'created'
}

// ── Full sync orchestration ────────────────────────────────────────────────

export async function runFullSync(
  prisma: PrismaClient,
  connectionId: string,
  userId: string,
  consent: ProviderConsent,
  provider: OpenBankingProvider,
  fromDate?: Date,
): Promise<SyncResult> {
  const from = fromDate ?? new Date(Date.now() - SYNC_WINDOW_DAYS * 86_400_000)
  const errors: string[] = []

  const accounts = await syncAccounts(prisma, connectionId, userId, consent, provider)

  let transactionsImported = 0
  let transactionsSkipped = 0

  for (const account of accounts) {
    const result = await syncTransactions(prisma, account, consent, provider, from)
    transactionsImported += result.imported
    transactionsSkipped += result.skipped
    errors.push(...result.errors)
  }

  // Update connection sync metadata
  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: errors.length === 0 ? 'success' : 'partial',
      lastSyncError: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
    },
  })

  return {
    accountsSynced: accounts.length,
    transactionsImported,
    transactionsSkipped,
    errors,
  }
}
