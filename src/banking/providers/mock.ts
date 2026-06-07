import { randomUUID } from 'crypto'
import type { OpenBankingProvider, ProviderAccount, ProviderConsent, ProviderTransaction } from '../types.js'

// ── Realistic UK merchant data ─────────────────────────────────────────────

interface MerchantTemplate {
  name: string
  category: string
  mcc?: string
  isSubscription?: boolean
  subscriptionName?: string
  typicalAmounts: number[]  // debit amounts (positive here, negated on write)
}

const MERCHANT_TEMPLATES: MerchantTemplate[] = [
  // Groceries
  { name: 'Tesco', category: 'groceries', mcc: '5411', typicalAmounts: [12.50, 34.20, 67.80, 102.40, 18.75, 45.60] },
  { name: "Sainsbury's", category: 'groceries', mcc: '5411', typicalAmounts: [28.90, 54.30, 89.20, 22.40, 41.70] },
  { name: 'Waitrose', category: 'groceries', mcc: '5411', typicalAmounts: [45.60, 78.90, 112.30, 31.20, 66.40] },
  { name: 'Aldi', category: 'groceries', mcc: '5411', typicalAmounts: [24.30, 38.70, 51.20, 17.80] },
  { name: 'Lidl', category: 'groceries', mcc: '5411', typicalAmounts: [19.40, 33.60, 48.90, 25.70] },
  // Restaurants & cafes
  { name: 'Deliveroo', category: 'restaurants', mcc: '5812', typicalAmounts: [18.50, 24.90, 32.40, 15.80, 28.60] },
  { name: 'Uber Eats', category: 'restaurants', mcc: '5812', typicalAmounts: [16.40, 22.80, 35.60, 19.20] },
  { name: 'Costa Coffee', category: 'restaurants', mcc: '5812', typicalAmounts: [3.85, 4.65, 6.40, 5.20, 7.80] },
  { name: 'Greggs', category: 'restaurants', mcc: '5812', typicalAmounts: [3.20, 2.50, 4.10, 5.80] },
  { name: 'Pret A Manger', category: 'restaurants', mcc: '5812', typicalAmounts: [5.25, 7.40, 8.90, 6.30] },
  { name: 'McDonald\'s', category: 'restaurants', mcc: '5812', typicalAmounts: [6.99, 8.49, 10.79, 5.49] },
  // Transport
  { name: 'TfL', category: 'transport', mcc: '4111', typicalAmounts: [2.50, 3.40, 4.80, 6.70, 9.20, 5.60] },
  { name: 'Trainline', category: 'transport', mcc: '4112', typicalAmounts: [24.50, 47.80, 89.30, 132.60, 18.90] },
  { name: 'Uber', category: 'transport', mcc: '4121', typicalAmounts: [8.40, 12.60, 18.90, 24.50, 6.80] },
  { name: 'National Rail', category: 'transport', mcc: '4112', typicalAmounts: [36.50, 72.40, 124.80, 28.90] },
  // Subscriptions
  { name: 'Netflix', category: 'subscriptions', mcc: '7395', isSubscription: true, subscriptionName: 'Netflix', typicalAmounts: [17.99] },
  { name: 'Spotify', category: 'subscriptions', mcc: '7372', isSubscription: true, subscriptionName: 'Spotify', typicalAmounts: [11.99] },
  { name: 'Amazon Prime', category: 'subscriptions', mcc: '5961', isSubscription: true, subscriptionName: 'Amazon Prime', typicalAmounts: [8.99] },
  { name: 'Apple iCloud', category: 'subscriptions', mcc: '7372', isSubscription: true, subscriptionName: 'Apple iCloud', typicalAmounts: [0.99, 2.99, 8.99] },
  { name: 'Gym Membership', category: 'subscriptions', mcc: '7997', isSubscription: true, subscriptionName: 'Gym', typicalAmounts: [34.99, 49.99, 29.99] },
  { name: 'Disney+', category: 'subscriptions', mcc: '7812', isSubscription: true, subscriptionName: 'Disney+', typicalAmounts: [4.99, 7.99] },
  // Other spending
  { name: 'Boots', category: 'health', mcc: '5912', typicalAmounts: [8.40, 14.90, 23.60, 37.80] },
  { name: 'Marks & Spencer', category: 'shopping', mcc: '5651', typicalAmounts: [24.50, 48.90, 72.30, 98.60, 16.40] },
  { name: 'ASOS', category: 'shopping', mcc: '5651', typicalAmounts: [34.99, 67.80, 112.40, 89.50] },
  { name: 'Amazon', category: 'shopping', mcc: '5961', typicalAmounts: [12.99, 24.50, 47.80, 89.30, 156.40] },
  { name: 'Vodafone', category: 'bills', mcc: '4813', isSubscription: true, subscriptionName: 'Vodafone Mobile', typicalAmounts: [35.00, 45.00, 55.00] },
]

// Rent as a fixed monthly debit
const RENT_AMOUNT = 1200.00

// Salary templates for the current account
const SALARY_AMOUNT = 2850.00

// ── Deterministic transaction generation ───────────────────────────────────

function pickRandom<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length] as T
}

function generateCurrentAccountTransactions(from: Date, to: Date): ProviderTransaction[] {
  const transactions: ProviderTransaction[] = []
  const msPerDay = 86_400_000

  const dayCount = Math.ceil((to.getTime() - from.getTime()) / msPerDay)

  // Monthly anchors: salary (28th) and rent (1st)
  for (let d = 0; d < dayCount; d++) {
    const date = new Date(from.getTime() + d * msPerDay)
    const dom = date.getDate()
    const month = date.getMonth()

    // Salary on the 28th of each month
    if (dom === 28) {
      transactions.push({
        providerTransactionId: `mock-current-salary-${date.getFullYear()}-${month}`,
        amount: SALARY_AMOUNT,
        currency: 'GBP',
        transactionType: 'credit',
        status: 'settled',
        merchantName: 'Employer Ltd',
        transactionDate: date,
        rawDescription: 'BACS SALARY EMPLOYER LTD',
        category: 'salary',
        isSalary: true,
      })
    }

    // Rent on the 1st of each month
    if (dom === 1) {
      transactions.push({
        providerTransactionId: `mock-current-rent-${date.getFullYear()}-${month}`,
        amount: -RENT_AMOUNT,
        currency: 'GBP',
        transactionType: 'debit',
        status: 'settled',
        merchantName: 'Landlord Property Ltd',
        transactionDate: date,
        rawDescription: 'SO LANDLORD PROPERTY LTD RENT',
        category: 'rent',
        isSubscription: false,
      })
    }

    // Subscriptions: fire on a fixed day each month
    const subscriptions = MERCHANT_TEMPLATES.filter((m) => m.isSubscription)
    for (const sub of subscriptions) {
      // Each subscription has a deterministic day-of-month (hash of name mod 28)
      const subDay = (sub.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 25) + 1
      if (dom === subDay) {
        const amount = sub.typicalAmounts[0] ?? 9.99
        transactions.push({
          providerTransactionId: `mock-current-sub-${sub.name.replace(/\s+/g, '-')}-${date.getFullYear()}-${month}`,
          amount: -amount,
          currency: 'GBP',
          transactionType: 'debit',
          status: 'settled',
          merchantName: sub.name,
          merchantCategoryCode: sub.mcc,
          transactionDate: date,
          rawDescription: sub.name.toUpperCase(),
          category: sub.category,
          isSubscription: true,
          subscriptionName: sub.subscriptionName,
        })
      }
    }

    // Day-to-day spending: 2–4 transactions per day, deterministic from date
    const daySeed = date.getFullYear() * 10000 + (month + 1) * 100 + dom
    const txCount = (daySeed % 3) + 2  // 2..4

    const nonSubscriptionMerchants = MERCHANT_TEMPLATES.filter((m) => !m.isSubscription)
    for (let t = 0; t < txCount; t++) {
      const merchant = pickRandom(nonSubscriptionMerchants, daySeed + t * 37)
      const amount = pickRandom(merchant.typicalAmounts, daySeed + t * 13)
      transactions.push({
        providerTransactionId: `mock-current-day-${daySeed}-${t}`,
        amount: -(amount ?? 10),
        currency: 'GBP',
        transactionType: 'debit',
        status: 'settled',
        merchantName: merchant.name,
        merchantCategoryCode: merchant.mcc,
        transactionDate: date,
        rawDescription: merchant.name.toUpperCase(),
        category: merchant.category,
        isSubscription: false,
      })
    }
  }

  return transactions
}

function generateSavingsAccountTransactions(from: Date, to: Date): ProviderTransaction[] {
  const transactions: ProviderTransaction[] = []
  const msPerDay = 86_400_000
  const dayCount = Math.ceil((to.getTime() - from.getTime()) / msPerDay)

  for (let d = 0; d < dayCount; d++) {
    const date = new Date(from.getTime() + d * msPerDay)
    const dom = date.getDate()
    const month = date.getMonth()

    // Monthly transfer in from current account on the 28th
    if (dom === 28) {
      transactions.push({
        providerTransactionId: `mock-savings-transfer-${date.getFullYear()}-${month}`,
        amount: 300.00,
        currency: 'GBP',
        transactionType: 'credit',
        status: 'settled',
        merchantName: undefined,
        transactionDate: date,
        rawDescription: 'FASTER PAYMENT FROM PERSONAL CURRENT',
        category: 'transfer',
      })
    }

    // Quarterly interest on the 1st of Jan/Apr/Jul/Oct
    if (dom === 1 && [0, 3, 6, 9].includes(month)) {
      transactions.push({
        providerTransactionId: `mock-savings-interest-${date.getFullYear()}-${month}`,
        amount: 12.40,
        currency: 'GBP',
        transactionType: 'credit',
        status: 'settled',
        merchantName: undefined,
        transactionDate: date,
        rawDescription: 'INTEREST PAID',
        category: 'income',
      })
    }
  }

  return transactions
}

// ── Mock provider implementation ───────────────────────────────────────────

export const MOCK_CONSENT: ProviderConsent = {
  providerConsentId: 'mock-consent-id',
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  tokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  scopes: ['accounts', 'transactions', 'balance'],
}

export const MOCK_ACCOUNTS: ProviderAccount[] = [
  {
    providerAccountId: 'mock-account-current',
    accountType: 'current',
    displayName: 'Personal Current Account',
    currency: 'GBP',
    currentBalance: 1847.32,
    availableBalance: 1847.32,
    accountLast4: '4782',
  },
  {
    providerAccountId: 'mock-account-savings',
    accountType: 'savings',
    displayName: 'Instant Access Saver',
    currency: 'GBP',
    currentBalance: 4250.00,
    availableBalance: 4250.00,
    accountLast4: '9341',
  },
]

export class MockOpenBankingProvider implements OpenBankingProvider {
  readonly providerName = 'mock'

  async initiateConsent(
    _userId: string,
    redirectUri: string,
  ): Promise<{ authUrl: string; state: string }> {
    const state = randomUUID()
    return {
      authUrl: `${redirectUri}?code=mock-auth-code&state=${state}`,
      state,
    }
  }

  async exchangeCode(_code: string, _state: string): Promise<ProviderConsent> {
    return { ...MOCK_CONSENT }
  }

  async getAccounts(_consent: ProviderConsent): Promise<ProviderAccount[]> {
    return MOCK_ACCOUNTS.map((a) => ({ ...a }))
  }

  async getTransactions(
    _consent: ProviderConsent,
    providerAccountId: string,
    from: Date,
    to: Date,
  ): Promise<ProviderTransaction[]> {
    if (providerAccountId === 'mock-account-current') {
      return generateCurrentAccountTransactions(from, to)
    }
    if (providerAccountId === 'mock-account-savings') {
      return generateSavingsAccountTransactions(from, to)
    }
    return []
  }

  async refreshToken(_consent: ProviderConsent): Promise<ProviderConsent> {
    return { ...MOCK_CONSENT, accessToken: `mock-refreshed-${Date.now()}` }
  }
}
