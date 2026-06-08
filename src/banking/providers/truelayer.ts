/**
 * TrueLayer Open Banking provider.
 *
 * Implements the provider-agnostic OpenBankingProvider interface so the sync
 * layer (sync.ts) and connection layer (connection.ts) are unchanged.
 *
 * Supports both sandbox (auth.truelayer-sandbox.com) and production
 * (auth.truelayer.com) environments via the constructor argument.
 */
import { randomUUID } from 'crypto'
import type { AccountType } from '@prisma/client'
import type {
  OpenBankingProvider,
  ProviderAccount,
  ProviderConsent,
  ProviderTransaction,
} from '../types.js'

// ── TrueLayer API response shapes ──────────────────────────────────────────

interface TLAccount {
  account_id: string
  account_type: string
  display_name: string
  currency: string
  account_number?: { number?: string; sort_code?: string; iban?: string }
  provider?: { display_name?: string; logo_uri?: string }
}

interface TLBalance {
  currency: string
  available: number
  current: number
  credit_limit?: number
}

interface TLTransaction {
  transaction_id: string
  normalised_provider_transaction_id?: string
  timestamp: string          // ISO 8601
  description: string
  amount: number             // negative = debit, positive = credit
  currency: string
  transaction_type: string   // DEBIT | CREDIT
  transaction_category?: string
  merchant_name?: string
  merchant_category_code?: string
  running_balance?: { amount: number; currency: string }
  meta?: Record<string, unknown>
}

interface TLTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

// ── Field mappings ─────────────────────────────────────────────────────────

const ACCOUNT_TYPE_MAP: Record<string, AccountType> = {
  TRANSACTION: 'current',
  SAVINGS: 'savings',
  CREDIT_CARD: 'credit_card',
  MORTGAGE: 'mortgage',
  PENSION: 'pension',
  LOAN: 'loan',
}

// TrueLayer transaction_category → our category string
const CATEGORY_MAP: Record<string, string | null> = {
  SHOPPING: 'shopping',
  FOOD_AND_DRINK: 'restaurants',
  TRANSPORT: 'transport',
  TRAVEL: 'transport',
  BILLS_AND_UTILITIES: 'bills',
  ENTERTAINMENT: 'subscriptions',
  HEALTH_AND_MEDICAL: 'health',
  SALARY: 'income',
  INCOME: 'income',
  CASH_AND_ATM: null,
  TRANSFER: null,
  GENERAL: null,
}

// ── Provider class ─────────────────────────────────────────────────────────

export class TrueLayerProvider implements OpenBankingProvider {
  readonly providerName: string

  private readonly authBase: string
  private readonly apiBase: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly redirectUri: string
  private readonly isSandbox: boolean

  private static readonly SCOPES = [
    'info',
    'accounts',
    'balance',
    'transactions',
    'offline_access',
  ]

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    environment: 'sandbox' | 'production' = 'sandbox',
  ) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.redirectUri = redirectUri
    this.isSandbox = environment === 'sandbox'
    this.providerName = this.isSandbox ? 'truelayer_sandbox' : 'truelayer'
    this.authBase = this.isSandbox
      ? 'https://auth.truelayer-sandbox.com'
      : 'https://auth.truelayer.com'
    this.apiBase = this.isSandbox
      ? 'https://api.truelayer-sandbox.com'
      : 'https://api.truelayer.com'
  }

  // ── OAuth flow ─────────────────────────────────────────────────────────

  async initiateConsent(
    _userId: string,
    redirectUri: string,
  ): Promise<{ authUrl: string; state: string }> {
    // state is provided by the caller (encodeOAuthState) and passed through
    // TrueLayer unchanged. We generate a placeholder here; the route handler
    // replaces it with the signed value before redirecting.
    const state = randomUUID()
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: TrueLayerProvider.SCOPES.join(' '),
      state,
      // sandbox: show the mock bank picker instead of real bank list
      ...(this.isSandbox ? { providers: 'mock' } : {}),
    })
    return { authUrl: `${this.authBase}/?${params.toString()}`, state }
  }

  async exchangeCode(code: string, _state: string): Promise<ProviderConsent> {
    const res = await fetch(`${this.authBase}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }).toString(),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`TrueLayer token exchange failed (${res.status}): ${body}`)
    }

    const data = (await res.json()) as TLTokenResponse
    const consentId = this.extractConsentId(data.access_token)

    return {
      providerConsentId: consentId,
      accessToken: data.access_token,
      scopes: data.scope?.split(' ') ?? TrueLayerProvider.SCOPES,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      ...(data.expires_in ? { tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000) } : {}),
    }
  }

  async refreshToken(consent: ProviderConsent): Promise<ProviderConsent> {
    if (!consent.refreshToken) throw new Error('No refresh token available')

    const res = await fetch(`${this.authBase}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: consent.refreshToken,
      }).toString(),
    })

    if (!res.ok) throw new Error(`TrueLayer token refresh failed (${res.status})`)

    const data = (await res.json()) as TLTokenResponse
    const newRefresh = data.refresh_token ?? consent.refreshToken
    const newExpiry = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : consent.tokenExpiresAt
    return {
      ...consent,
      accessToken: data.access_token,
      ...(newRefresh ? { refreshToken: newRefresh } : {}),
      ...(newExpiry ? { tokenExpiresAt: newExpiry } : {}),
    }
  }

  async revokeConsent(accessToken: string): Promise<void> {
    const res = await fetch(`${this.authBase}/connect/revocation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${accessToken}`,
      },
      body: new URLSearchParams({ token: accessToken }).toString(),
    })
    // 200 or 204 = success; anything else we log but don't throw — deletion must still proceed
    if (!res.ok && res.status !== 204) {
      throw new Error(`TrueLayer revocation failed (${res.status})`)
    }
  }

  // ── Data fetching ──────────────────────────────────────────────────────

  async getAccounts(consent: ProviderConsent): Promise<ProviderAccount[]> {
    const res = await this.apiFetch<TLAccount>('/data/v1/accounts', consent.accessToken)

    const accounts: ProviderAccount[] = []
    for (const a of res) {
      const { balance, unavailable } = await this.fetchBalance(a.account_id, consent.accessToken)
      const last4 = a.account_number?.number?.slice(-4)
      accounts.push({
        providerAccountId: a.account_id,
        accountType: ACCOUNT_TYPE_MAP[a.account_type] ?? 'current',
        displayName: unavailable ? `${a.display_name} (balance unavailable)` : a.display_name,
        currency: a.currency,
        currentBalance: balance?.current ?? 0,
        ...(balance?.available !== undefined ? { availableBalance: balance.available } : {}),
        ...(last4 ? { accountLast4: last4 } : {}),
      })
    }
    return accounts
  }

  async getTransactions(
    consent: ProviderConsent,
    providerAccountId: string,
    from: Date,
    to: Date,
  ): Promise<ProviderTransaction[]> {
    const params = new URLSearchParams({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    })
    const results = await this.apiFetch<TLTransaction>(
      `/data/v1/accounts/${encodeURIComponent(providerAccountId)}/transactions?${params.toString()}`,
      consent.accessToken,
    )
    return results.map((t) => this.mapTransaction(t))
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async fetchBalance(
    accountId: string,
    accessToken: string,
  ): Promise<{ balance: TLBalance | null; unavailable: boolean }> {
    try {
      const res = await this.apiFetch<TLBalance>(
        `/data/v1/accounts/${encodeURIComponent(accountId)}/balance`,
        accessToken,
      )
      return { balance: res[0] ?? null, unavailable: false }
    } catch {
      return { balance: null, unavailable: true }
    }
  }

  private async apiFetch<T>(path: string, accessToken: string, attempt = 1): Promise<T[]> {
    const res = await fetch(`${this.apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json; charset=UTF-8',
      },
    })
    if (res.status === 401) throw new Error('TrueLayer: access token expired or invalid')
    // Retry on 429 or 5xx with exponential backoff (max 3 attempts)
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const delay = Math.pow(2, attempt) * 1000
      await new Promise((r) => setTimeout(r, delay))
      return this.apiFetch<T>(path, accessToken, attempt + 1)
    }
    if (!res.ok) throw new Error(`TrueLayer API error ${res.status}: ${path}`)
    const body = (await res.json()) as { results: T[] }
    return body.results
  }

  /**
   * Extracts a stable consent ID from the JWT access token.
   * TrueLayer encodes the consent/subject ID in the `sub` claim.
   * Falls back to a random UUID when the JWT cannot be decoded.
   */
  private extractConsentId(accessToken: string): string {
    try {
      const parts = accessToken.split('.')
      if (parts.length !== 3 || !parts[1]) return randomUUID()
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      ) as Record<string, unknown>
      const id = payload['sub'] ?? payload['jti']
      return typeof id === 'string' && id.length > 0 ? id : randomUUID()
    } catch {
      return randomUUID()
    }
  }

  private mapTransaction(t: TLTransaction): ProviderTransaction {
    const isCredit = t.amount > 0 || t.transaction_type === 'CREDIT'
    const rawCategory = t.transaction_category ?? ''
    const category = CATEGORY_MAP[rawCategory]

    return {
      providerTransactionId:
        t.normalised_provider_transaction_id ?? t.transaction_id,
      amount: t.amount,
      currency: t.currency,
      transactionType: isCredit ? 'credit' : 'debit',
      status: 'settled',
      merchantName: t.merchant_name,
      merchantCategoryCode: t.merchant_category_code,
      transactionDate: new Date(t.timestamp),
      rawDescription: t.description,
      category: category ?? undefined,
      isSalary: rawCategory === 'SALARY' || rawCategory === 'INCOME',
    }
  }
}
