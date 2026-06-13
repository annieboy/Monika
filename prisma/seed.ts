/**
 * Database seeder — categories and MVP offers.
 *
 * Run: npm run db:seed
 *
 * Idempotent — safe to run multiple times. Uses upsert so existing records
 * are updated, not duplicated.
 */
import { PrismaClient } from '@prisma/client'
import { seedOfferCategories } from './seeds/offerCategories.js'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Seeding database...')

  const { categories, offers } = await seedOfferCategories(prisma)

  // eslint-disable-next-line no-console
  console.log(`✓ ${categories} offer categories upserted`)
  // eslint-disable-next-line no-console
  console.log(`✓ ${offers} offers upserted`)
  // eslint-disable-next-line no-console
  console.log('Seed complete.')
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
