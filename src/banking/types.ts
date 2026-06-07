import type { AccountType, TransactionType, TransactionStatus } from '@prisma/client'

// ── Provider-agnostic data shapes ──────────────────────────────────────────

export interface ProviderAccount {
  providerAccountId: string
  accountType: AccountType
  displayName: string
  currency: string
  currentBalance: number
  availableBalance?: number
  accountLast4?: string
}

export interface ProviderTransaction {
  providerTransactionId: string
  amount: number          // negative = debit, positive = credit
  currency: string
  transactionType: TransactionType
  status: TransactionStatus
  merchantName?: string | undefined
  merchantCategoryCode?: string | undefined
  transactionDate: Date
  valueDate?: Date | undefined
  rawDescription: string
  category?: string | undefined
  isSalary?: boolean | undefined
  isSubscription?: boolean | undefined
  subscriptionName?: string | undefined
}

export interface ProviderConsent {
  providerConsentId: string
  accessToken: string
  refreshToken?: string
  tokenExpiresAt?: Date
  scopes: string[]
}

// ── Provider interface ─────────────────────────────────────────────────────

export interface OpenBankingProvider {
  readonly providerName: string

  /** Step 1: Generate an auth URL to redirect the user to. */
  initiateConsent(
    userId: string,
    redirectUri: string,
  ): Promise<{ authUrl: string; state: string }>

  /** Step 2: Exchange the OAuth callback code for tokens. */
  exchangeCode(code: string, state: string): Promise<ProviderConsent>

  /** Fetch the list of accounts for an active consent. */
  getAccounts(consent: ProviderConsent): Promise<ProviderAccount[]>

  /** Fetch transactions for one account within a date range. */
  getTransactions(
    consent: ProviderConsent,
    providerAccountId: string,
    from: Date,
    to: Date,
  ): Promise<ProviderTransaction[]>

  /** Refresh an expiring access token. */
  refreshToken(consent: ProviderConsent): Promise<ProviderConsent>
}
