/**
 * Seed file — offer categories and initial MVP offers.
 *
 * Run with: npx ts-node --esm prisma/seeds/offerCategories.ts
 * Or via:   npm run db:seed
 *
 * Idempotent — safe to run multiple times.
 * Uses upsertOffer so existing offers are updated, not duplicated.
 */
import { PrismaClient } from '@prisma/client'
import { upsertOffer } from '../../src/services/offers/offerUpsertService.js'

const prisma = new PrismaClient()

const CATEGORIES = [
  { slug: 'savings',          name: 'Savings Accounts', iconEmoji: '💰', sortOrder: 1 },
  { slug: 'broadband',        name: 'Broadband',         iconEmoji: '📡', sortOrder: 2 },
  { slug: 'mobile',           name: 'Mobile',            iconEmoji: '📱', sortOrder: 3 },
  { slug: 'business-banking', name: 'Business Banking',  iconEmoji: '🏦', sortOrder: 4 },
  { slug: 'accounting',       name: 'Accounting Software', iconEmoji: '📊', sortOrder: 5 },
]

const SEED_OFFERS = [
  // ── Savings ──────────────────────────────────────────────────────────────
  {
    providerName: 'Marcus by Goldman Sachs',
    providerSlug: 'marcus-goldman-sachs',
    categorySlug: 'savings',
    title: 'Easy Access Savings Account',
    shortDescription: '4.75% AER variable, no lock-in, FSCS protected',
    keyBenefits: ['No withdrawal restrictions', 'FSCS protected up to £85k', 'Manage online or via app', 'No monthly fee'],
    keyTerms: ['£1 minimum deposit', 'UK residents only', 'Rate is variable'],
    parameters: { aer: 4.75, accessType: 'easy_access', minDeposit: 1, maxDeposit: 250000, fscsProtected: true },
    affiliateNetwork: 'direct' as const,
    affiliateProgramId: 'marcus-uk',
    affiliateBaseUrl: 'https://www.marcus.co.uk/uk/en/savings/easy-access',
    commissionType: 'cpa' as const,
    commissionValue: 25,
    targetMerchantSlugs: [],
    targetCategories: [],
    requiresBankLink: false,
    isRegulated: true,
    fcaDisclaimer: '⚠️ _Information only, not financial advice. 4.75% AER variable — rates may change. FSCS protected up to £85,000 per institution. Always read full T&Cs._',
  },
  {
    providerName: 'Chip',
    providerSlug: 'chip',
    categorySlug: 'savings',
    title: 'Instant Access Savings',
    shortDescription: '5.1% AER via ChipX account, easy-access',
    keyBenefits: ['Auto-save from your current account', 'FSCS protected', 'Withdraw anytime', 'App-based'],
    keyTerms: ['£1 minimum', 'Rates may change', 'ChipX membership required'],
    parameters: { aer: 5.1, accessType: 'easy_access', minDeposit: 1, fscsProtected: true },
    affiliateNetwork: 'awin' as const,
    affiliateProgramId: '12345',
    affiliateBaseUrl: 'https://getchip.uk',
    commissionType: 'cpa' as const,
    commissionValue: 20,
    targetMerchantSlugs: [],
    targetCategories: [],
    requiresBankLink: false,
    isRegulated: true,
  },

  // ── Broadband ─────────────────────────────────────────────────────────────
  {
    providerName: 'Vodafone',
    providerSlug: 'vodafone-broadband',
    categorySlug: 'broadband',
    title: 'Fibre 2 Broadband',
    shortDescription: '100Mbps fibre broadband, 24-month contract',
    keyBenefits: ['Average 100Mbps download', 'Free router included', 'No set-up fee', 'Online account management'],
    keyTerms: ['24-month contract', 'Price may increase annually', 'Subject to availability'],
    parameters: { speedMbps: 100, contractMonths: 24, monthlyPrice: 28, setupFee: 0, technology: 'fttc' },
    affiliateNetwork: 'awin' as const,
    affiliateProgramId: '23456',
    affiliateBaseUrl: 'https://www.vodafone.co.uk/broadband',
    commissionType: 'cpa' as const,
    commissionValue: 70,
    targetMerchantSlugs: ['sky', 'bt', 'virgin-media', 'talktalk'],
    targetCategories: ['broadband'],
    requiresBankLink: true,
  },
  {
    providerName: 'BT',
    providerSlug: 'bt',
    categorySlug: 'broadband',
    title: 'Full Fibre 100',
    shortDescription: '100Mbps full-fibre broadband, 24-month contract',
    keyBenefits: ['Full-fibre FTTP', 'Smart Hub 2 included', 'BT Sport free for 3 months', 'UK-based support'],
    keyTerms: ['24-month contract', 'FTTP availability varies', 'Annual price increase applies'],
    parameters: { speedMbps: 100, contractMonths: 24, monthlyPrice: 29.99, setupFee: 0, technology: 'fttp' },
    affiliateNetwork: 'cj' as const,
    affiliateProgramId: '34567',
    affiliateBaseUrl: 'https://www.bt.com/broadband',
    commissionType: 'cpa' as const,
    commissionValue: 80,
    targetMerchantSlugs: ['sky', 'virgin-media', 'talktalk', 'vodafone-broadband'],
    targetCategories: ['broadband'],
    requiresBankLink: true,
  },

  // ── Mobile ────────────────────────────────────────────────────────────────
  {
    providerName: 'iD Mobile',
    providerSlug: 'id-mobile',
    categorySlug: 'mobile',
    title: 'Unlimited Data SIM',
    shortDescription: 'Unlimited data, calls & texts — 24-month SIM-only',
    keyBenefits: ['Unlimited data', 'Runs on Three network', 'No lock-in after 24 months', 'eSIM compatible'],
    keyTerms: ['24-month contract', 'Fair use policy on data', 'Roaming charges may apply'],
    parameters: { dataGb: 'unlimited', contractMonths: 24, monthlyPrice: 19, network: 'Three' },
    affiliateNetwork: 'awin' as const,
    affiliateProgramId: '45678',
    affiliateBaseUrl: 'https://www.idmobile.co.uk',
    commissionType: 'cpa' as const,
    commissionValue: 30,
    targetMerchantSlugs: ['ee', 'o2', 'vodafone', 'three'],
    targetCategories: ['mobile'],
    requiresBankLink: true,
  },
  {
    providerName: 'SMARTY',
    providerSlug: 'smarty',
    categorySlug: 'mobile',
    title: '100GB Data SIM',
    shortDescription: '100GB data, no contract, cancel anytime',
    keyBenefits: ['No contract', 'Hotspot included', 'EU roaming included', 'SMARTY cashback on unused data'],
    keyTerms: ['Rolling monthly plan', 'Runs on Three network', 'Subject to coverage'],
    parameters: { dataGb: 100, contractMonths: 1, monthlyPrice: 15, network: 'Three' },
    affiliateNetwork: 'impact' as const,
    affiliateProgramId: '56789',
    affiliateBaseUrl: 'https://smarty.co.uk',
    commissionType: 'cpa' as const,
    commissionValue: 25,
    targetMerchantSlugs: ['ee', 'o2', 'vodafone', 'three'],
    targetCategories: ['mobile'],
    requiresBankLink: true,
  },

  // ── Business Banking ──────────────────────────────────────────────────────
  {
    providerName: 'Tide',
    providerSlug: 'tide',
    categorySlug: 'business-banking',
    title: 'Free Business Current Account',
    shortDescription: 'Free UK banking for sole traders and limited companies',
    keyBenefits: ['No monthly fee (free plan)', '20 free transfers/month', 'Instant account opening', 'Xero & QuickBooks integration', 'Expense cards for team'],
    keyTerms: ['20p per transfer after free allowance', 'FCA-regulated e-money institution', 'Deposits held by Clearbank (FSCS eligible)'],
    parameters: { monthlyFee: 0, freeTransactionMonths: 99, overdraftAvailable: false, fdicEquivalent: true },
    affiliateNetwork: 'direct' as const,
    affiliateProgramId: 'tide-uk',
    affiliateBaseUrl: 'https://www.tide.co/refer',
    commissionType: 'cpa' as const,
    commissionValue: 50,
    targetMerchantSlugs: ['barclays', 'hsbc', 'lloyds', 'natwest'],
    targetCategories: ['banking'],
    requiresBankLink: false,
    fcaDisclaimer: '⚠️ _Information only, not financial advice. Tide is an FCA-regulated e-money institution, not a bank. Deposits held by Clearbank may be FSCS eligible. Always check the full terms._',
  },
  {
    providerName: 'Starling Bank',
    providerSlug: 'starling',
    categorySlug: 'business-banking',
    title: 'Business Current Account',
    shortDescription: 'Free business banking with real-time notifications',
    keyBenefits: ['No monthly fee', 'Unlimited free UK transfers', 'Full FSCS protection', 'Instant spending notifications', 'Business Mastercard included'],
    keyTerms: ['UK-registered business required', 'Subject to eligibility', 'FSCS protected up to £85k'],
    parameters: { monthlyFee: 0, freeTransactionMonths: 99, overdraftAvailable: true, fdicEquivalent: true },
    affiliateNetwork: 'awin' as const,
    affiliateProgramId: '67890',
    affiliateBaseUrl: 'https://www.starlingbank.com/business',
    commissionType: 'cpa' as const,
    commissionValue: 60,
    targetMerchantSlugs: ['barclays', 'hsbc', 'lloyds', 'natwest', 'santander'],
    targetCategories: ['banking'],
    requiresBankLink: false,
  },

  // ── Accounting ────────────────────────────────────────────────────────────
  {
    providerName: 'FreeAgent',
    providerSlug: 'freeagent',
    categorySlug: 'accounting',
    title: 'FreeAgent Accounting',
    shortDescription: 'Full accounting software for freelancers and small businesses',
    keyBenefits: ['Unlimited invoices', 'VAT returns (MTD ready)', 'Self-assessment support', 'Bank feed integration', 'Project tracking'],
    keyTerms: ['£19/month after trial', '30-day free trial', 'Owned by NatWest Group'],
    parameters: { monthlyPrice: 19, tier: 'Standard', trialDays: 30, features: ['Invoicing', 'VAT returns', 'Self-assessment', 'Bank feeds', 'Expense tracking'] },
    affiliateNetwork: 'cj' as const,
    affiliateProgramId: '78901',
    affiliateBaseUrl: 'https://www.freeagent.com',
    commissionType: 'cpa' as const,
    commissionValue: 40,
    targetMerchantSlugs: ['xero', 'quickbooks', 'sage'],
    targetCategories: ['accounting', 'software'],
    requiresBankLink: false,
  },
  {
    providerName: 'Xero',
    providerSlug: 'xero',
    categorySlug: 'accounting',
    title: 'Xero Starter',
    shortDescription: 'Cloud accounting for small businesses — invoices, bank reconciliation',
    keyBenefits: ['20 invoices/month', 'Bank feeds', 'MTD VAT ready', 'Hundreds of integrations', '24/7 online support'],
    keyTerms: ['Invoice limit on Starter plan', 'Price may increase', '30-day free trial available'],
    parameters: { monthlyPrice: 16, tier: 'Starter', trialDays: 30, features: ['20 invoices', 'Bank reconciliation', 'MTD VAT', 'Payroll add-on'] },
    affiliateNetwork: 'awin' as const,
    affiliateProgramId: '89012',
    affiliateBaseUrl: 'https://www.xero.com/uk',
    commissionType: 'revenue_share' as const,
    commissionValue: 0.20,
    targetMerchantSlugs: ['quickbooks', 'sage', 'freeagent'],
    targetCategories: ['accounting', 'software'],
    requiresBankLink: false,
  },
]

async function seed(): Promise<void> {
  console.log('Seeding offer categories...')
  for (const cat of CATEGORIES) {
    await prisma.offerCategory.upsert({
      where: { slug: cat.slug },
      create: cat,
      update: { name: cat.name, iconEmoji: cat.iconEmoji, sortOrder: cat.sortOrder },
    })
    console.log(`  ✓ ${cat.slug}`)
  }

  console.log('\nSeeding offers...')
  for (const offer of SEED_OFFERS) {
    const result = await upsertOffer(prisma, offer)
    console.log(`  ${result.action === 'created' ? '✓' : '↑'} ${offer.providerName} — ${offer.title} (${result.action})`)
  }

  console.log('\n✅ Seed complete')
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
