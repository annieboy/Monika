/**
 * Test user seed — creates a realistic user with transactions, accounts,
 * recurring payments, and savings goals so all WhatsApp features can be exercised.
 *
 * Run: npx tsx prisma/seeds/testUser.ts
 *
 * Requires DATABASE_URL, ENCRYPTION_KEY, and SECRET_KEY in your .env.
 * Safe to re-run — cleans up and recreates dependent rows.
 *
 * IMPORTANT: Only run against a dev/test database, not production.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPhoneNumber, encrypt } from '../../src/lib/crypto.js'

const prisma = new PrismaClient()

// Override via env: TEST_PHONE=+447911123456 npx tsx prisma/seeds/testUser.ts
const PHONE = process.env.TEST_PHONE ?? '+447700900000'
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? ''
const SECRET_KEY = process.env.SECRET_KEY ?? ''

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

async function main(): Promise<void> {
  console.log(`Seeding test user for phone ${PHONE}...`)

  const digits = PHONE.replace(/\D/g, '')
  const phoneHash = hashPhoneNumber(digits, SECRET_KEY)
  const phoneEnc = encrypt(Buffer.from(PHONE, 'utf-8'), ENCRYPTION_KEY) as unknown as Uint8Array<ArrayBuffer>

  // ── User ─────────────────────────────────────────────────────────────────────
  const user = await prisma.user.upsert({
    where: { whatsappPhoneHash: phoneHash },
    create: {
      whatsappPhoneHash: phoneHash,
      whatsappPhoneEnc: phoneEnc,
      whatsappWabaId: 'waba-test',
      displayName: 'Test User',
    },
    update: { displayName: 'Test User' },
  })
  console.log(`✓ User: ${user.id}`)

  // ── Bank connection ───────────────────────────────────────────────────────────
  const conn = await prisma.bankConnection.upsert({
    where: { id: 'seed-conn-1' },
    create: {
      id: 'seed-conn-1',
      userId: user.id,
      provider: 'truelayer',
      providerConsentId: 'consent-seed-1',
      bankId: 'mock-bank',
      bankDisplayName: 'Mock Bank',
      accessTokenEnc: Buffer.from('fake-token'),
      consentStatus: 'active',
      consentScopes: ['accounts', 'transactions', 'balance'],
      consentExpiresAt: new Date(Date.now() + 90 * 86_400_000),
      tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    update: { consentStatus: 'active' },
  })
  console.log(`✓ Bank connection: ${conn.id}`)

  // ── Accounts ──────────────────────────────────────────────────────────────────
  await prisma.account.upsert({
    where: { id: 'seed-acc-1' },
    create: {
      id: 'seed-acc-1',
      userId: user.id,
      bankConnectionId: conn.id,
      providerAccountId: 'provider-acc-1',
      accountType: 'current',
      accountName: 'Current Account',
      currency: 'GBP',
      currentBalance: 1842.50,
      availableBalance: 1842.50,
    },
    update: { currentBalance: 1842.50, availableBalance: 1842.50 },
  })

  await prisma.account.upsert({
    where: { id: 'seed-acc-2' },
    create: {
      id: 'seed-acc-2',
      userId: user.id,
      bankConnectionId: conn.id,
      providerAccountId: 'provider-acc-2',
      accountType: 'savings',
      accountName: 'Savings Account',
      currency: 'GBP',
      currentBalance: 4200.00,
      availableBalance: 4200.00,
    },
    update: { currentBalance: 4200.00, availableBalance: 4200.00 },
  })
  console.log('✓ Accounts (current + savings)')

  // ── Transactions ──────────────────────────────────────────────────────────────
  await prisma.transaction.deleteMany({
    where: { userId: user.id, providerTransactionId: { startsWith: 'seed-tx-' } },
  })

  type TxType = 'credit' | 'debit'
  const txRows: Array<{
    id: string; amount: number; category: string; merchantName: string
    daysAgo: number; type?: TxType; isRecurring?: boolean
  }> = [
    // Income
    { id: 'seed-tx-salary',     amount: 3500,   category: 'income',        merchantName: 'Employer Ltd',      daysAgo: 15, type: 'credit' },
    { id: 'seed-tx-salary2',    amount: 3500,   category: 'income',        merchantName: 'Employer Ltd',      daysAgo: 45, type: 'credit' },
    // Groceries — current month
    { id: 'seed-tx-tesco1',     amount: -87.43, category: 'groceries',     merchantName: 'Tesco',             daysAgo: 2 },
    { id: 'seed-tx-tesco2',     amount: -62.18, category: 'groceries',     merchantName: 'Tesco',             daysAgo: 9 },
    { id: 'seed-tx-sainsbury',  amount: -54.22, category: 'groceries',     merchantName: "Sainsbury's",       daysAgo: 5 },
    { id: 'seed-tx-waitrose',   amount: -43.10, category: 'groceries',     merchantName: 'Waitrose',          daysAgo: 14 },
    // Dining
    { id: 'seed-tx-deliveroo',  amount: -28.50, category: 'dining',        merchantName: 'Deliveroo',         daysAgo: 3 },
    { id: 'seed-tx-nandos',     amount: -22.80, category: 'dining',        merchantName: "Nando's",           daysAgo: 8 },
    { id: 'seed-tx-pret',       amount: -6.40,  category: 'dining',        merchantName: 'Pret A Manger',     daysAgo: 1 },
    { id: 'seed-tx-ubereats',   amount: -19.99, category: 'dining',        merchantName: 'Uber Eats',         daysAgo: 6 },
    // Transport
    { id: 'seed-tx-tfl1',       amount: -4.80,  category: 'transport',     merchantName: 'TfL',               daysAgo: 1 },
    { id: 'seed-tx-tfl2',       amount: -4.80,  category: 'transport',     merchantName: 'TfL',               daysAgo: 2 },
    { id: 'seed-tx-uber1',      amount: -14.20, category: 'transport',     merchantName: 'Uber',              daysAgo: 4 },
    // Shopping
    { id: 'seed-tx-amazon1',    amount: -34.99, category: 'shopping',      merchantName: 'Amazon',            daysAgo: 7 },
    { id: 'seed-tx-amazon2',    amount: -12.49, category: 'shopping',      merchantName: 'Amazon',            daysAgo: 20 },
    { id: 'seed-tx-asos',       amount: -67.00, category: 'shopping',      merchantName: 'ASOS',              daysAgo: 10 },
    // Subscriptions
    { id: 'seed-tx-netflix',    amount: -15.99, category: 'subscriptions', merchantName: 'Netflix',           daysAgo: 12, isRecurring: true },
    { id: 'seed-tx-spotify',    amount: -10.99, category: 'subscriptions', merchantName: 'Spotify',           daysAgo: 12, isRecurring: true },
    { id: 'seed-tx-gym',        amount: -45.00, category: 'subscriptions', merchantName: 'PureGym',           daysAgo: 5,  isRecurring: true },
    { id: 'seed-tx-broadband',  amount: -39.99, category: 'broadband',     merchantName: 'BT',                daysAgo: 8,  isRecurring: true },
    // Bills
    { id: 'seed-tx-electric',   amount: -72.00, category: 'utilities',     merchantName: 'Octopus Energy',    daysAgo: 18, isRecurring: true },
    { id: 'seed-tx-council',    amount: -134.00, category: 'utilities',    merchantName: 'Council Tax',       daysAgo: 20, isRecurring: true },
    // Previous month (for trends)
    { id: 'seed-tx-tesco-pm1',  amount: -71.10, category: 'groceries',     merchantName: 'Tesco',             daysAgo: 32 },
    { id: 'seed-tx-tesco-pm2',  amount: -55.00, category: 'groceries',     merchantName: 'Tesco',             daysAgo: 38 },
    { id: 'seed-tx-dining-pm',  amount: -95.00, category: 'dining',        merchantName: 'Deliveroo',         daysAgo: 35 },
    // Charity
    { id: 'seed-tx-charity1',   amount: -10.00, category: 'charity',       merchantName: 'Cancer Research UK', daysAgo: 25 },
    { id: 'seed-tx-charity2',   amount: -5.00,  category: 'charity',       merchantName: 'Oxfam',             daysAgo: 40 },
    // Foreign
    { id: 'seed-tx-foreign',    amount: -42.00, category: 'travel',        merchantName: 'Restaurant Paris',  daysAgo: 60 },
  ]

  for (const tx of txRows) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: 'seed-acc-1',
        providerTransactionId: tx.id,
        amount: tx.amount,
        currency: 'GBP',
        transactionType: tx.type === 'credit' ? 'credit' : 'debit',
        status: 'settled',
        transactionDate: daysAgo(tx.daysAgo),
        merchantName: tx.merchantName,
        merchantNameClean: tx.merchantName,
        category: tx.category,
        isRecurring: tx.isRecurring ?? false,
        rawDescription: tx.merchantName,
      },
    })
  }
  console.log(`✓ ${txRows.length} transactions`)

  // ── Recurring payments ────────────────────────────────────────────────────────
  const recurring = [
    { slug: 'netflix',      name: 'Netflix',        category: 'streaming',      amount: 15.99, freq: 'monthly' },
    { slug: 'spotify',      name: 'Spotify',         category: 'entertainment',  amount: 10.99, freq: 'monthly' },
    { slug: 'puregym',      name: 'PureGym',         category: 'membership',     amount: 45.00, freq: 'monthly' },
    { slug: 'bt',           name: 'BT',              category: 'broadband',      amount: 39.99, freq: 'monthly' },
    { slug: 'octopus',      name: 'Octopus Energy',  category: 'utilities',      amount: 72.00, freq: 'monthly' },
    { slug: 'council-tax',  name: 'Council Tax',     category: 'utilities',      amount: 134.00, freq: 'monthly' },
  ]

  for (const r of recurring) {
    await prisma.recurringPayment.upsert({
      where: { userId_merchantSlug: { userId: user.id, merchantSlug: r.slug } },
      create: {
        userId: user.id,
        merchantName: r.name,
        merchantSlug: r.slug,
        merchantCategory: r.category,
        typicalAmount: r.amount,
        frequency: r.freq,
        isActive: true,
        status: 'active',
        currency: 'GBP',
        firstSeenAt: daysAgo(90),
        lastSeenAt: daysAgo(5),
        occurrenceCount: 3,
        nextExpectedDate: new Date(Date.now() + 20 * 86_400_000),
      },
      update: { typicalAmount: r.amount, isActive: true },
    })
  }
  console.log(`✓ ${recurring.length} recurring payments`)

  // ── Savings goals ─────────────────────────────────────────────────────────────
  await prisma.savingsGoal.upsert({
    where: { id: 'seed-goal-holiday' },
    create: {
      id: 'seed-goal-holiday',
      userId: user.id,
      name: 'Holiday to Japan',
      targetAmount: 3000,
      currentAmount: 1800,
      monthlySavings: 200,
      targetDate: new Date('2025-10-01'),
      status: 'active',
    },
    update: { currentAmount: 1800 },
  })

  await prisma.savingsGoal.upsert({
    where: { id: 'seed-goal-car-loan' },
    create: {
      id: 'seed-goal-car-loan',
      userId: user.id,
      name: 'Pay off Car Loan',
      targetAmount: 8000,
      currentAmount: 3200,
      monthlySavings: 400,
      status: 'active',
    },
    update: { currentAmount: 3200 },
  })
  console.log('✓ Savings goals (holiday + debt payoff at 40%)')

  console.log('\n✅ Seed complete!\n')
  console.log(`Phone to use: ${PHONE}`)
  console.log('\nTest these phrases on WhatsApp:')
  const phrases = [
    '"What\'s my balance?"',
    '"How much did I spend on groceries this month?"',
    '"What are my subscriptions?"',
    '"Upcoming bills"',
    '"How much can I safely spend this weekend?"',
    '"Am I saving enough?"',
    '"My savings goals"',
    '"Can I afford a £300k mortgage?"',
    '"How much will I spend by end of month?"',
    '"Is my spending trending up?"',
    '"What\'s my credit health?"',
    '"How much did I donate to charity?"',
    '"What\'s my financial health?"',
    '"Best cashback credit card?"',
    '"How much income tax would I pay on £60,000?"',
    '"Show me my recent transactions"',
  ]
  phrases.forEach(p => console.log(`  • ${p}`))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
