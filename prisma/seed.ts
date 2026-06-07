/**
 * Database seeder — development and test data only.
 *
 * Run: npm run db:seed
 *
 * This is a placeholder. Actual seed data (test users, synthetic transactions)
 * will be added in Task 3.x once the categorisation pipeline exists.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Seeding database...')

  // TODO: Add test users and synthetic transactions once categorisation pipeline exists
  // Reference: IMPLEMENTATION_PLAN.md § Task 6.3 (TransactionSyncWorker)

  // eslint-disable-next-line no-console
  console.log('Seed complete (no data yet — add seed data in Task 6.3)')
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
