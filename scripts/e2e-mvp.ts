#!/usr/bin/env tsx
/**
 * Monika MVP End-to-End Test
 *
 * Runs the full user journey against a locally running server:
 *   1. Server health check
 *   2. Simulate a WhatsApp message → create user
 *   3. Ask to connect bank → receive link with one-time token
 *   4. Connect mock bank → import accounts + transactions
 *   5. Ask spending question → verify data-driven response
 *   6. Ask subscription question → verify subscriptions listed
 *   7. Ask balance question → verify balance shown
 *   8. Verify admin dashboard is accessible
 *   9. Print verification checklist
 *
 * Usage:
 *   npm run e2e                      # uses default settings
 *   BASE_URL=http://localhost:3001 npm run e2e
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=yourpw npm run e2e
 */

import { config as dotenv } from 'dotenv'
dotenv()

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:3000'
const ADMIN_USER = process.env['ADMIN_USERNAME'] ?? 'admin'
const ADMIN_PASS = process.env['ADMIN_PASSWORD'] ?? 'changeme1'
const TEST_PHONE = process.env['E2E_PHONE'] ?? '+447700900001'

// ── Colour helpers ─────────────────────────────────────────────────────────

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { headers })
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function getJson<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await get(path, headers)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await post(path, body, headers)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

function adminAuthHeader(): Record<string, string> {
  const creds = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')
  return { Authorization: `Basic ${creds}` }
}

// ── Step runner ────────────────────────────────────────────────────────────

let stepNum = 0
let passed = 0
let failed = 0

async function step<T>(
  label: string,
  fn: () => Promise<T>,
  check?: (result: T) => string | null, // return null = pass, string = failure reason
): Promise<T | null> {
  stepNum++
  const prefix = c.dim(`[${String(stepNum).padStart(2, '0')}]`)
  process.stdout.write(`${prefix} ${label}... `)

  const start = Date.now()
  try {
    const result = await fn()
    const ms = Date.now() - start

    if (check) {
      const reason = check(result)
      if (reason) {
        console.log(c.red(`✗ FAIL`) + c.dim(` (${ms}ms)`))
        console.log(c.red(`     → ${reason}`))
        failed++
        return null
      }
    }

    console.log(c.green(`✓`) + c.dim(` (${ms}ms)`))
    passed++
    return result
  } catch (err) {
    const ms = Date.now() - start
    console.log(c.red(`✗ ERROR`) + c.dim(` (${ms}ms)`))
    console.log(c.red(`     → ${err instanceof Error ? err.message : String(err)}`))
    failed++
    return null
  }
}

// ── Wait for server ────────────────────────────────────────────────────────

async function waitForServer(maxWaitMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`)
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// ── Main flow ──────────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log(c.bold('  Monika MVP — End-to-End Test'))
  console.log(c.dim(`  ${BASE_URL}  ·  phone: ${TEST_PHONE}`))
  console.log()

  // ── 0. Wait for server ─────────────────────────────────────────────────
  process.stdout.write(c.dim(`[00] Waiting for server at ${BASE_URL}... `))
  const alive = await waitForServer()
  if (!alive) {
    console.log(c.red('✗ Not reachable'))
    console.log()
    console.log(c.red('  Server is not running. Start it with:'))
    console.log(c.cyan('    npm run dev'))
    console.log()
    process.exit(1)
  }
  console.log(c.green('✓ Online'))

  // ── 1. Health ──────────────────────────────────────────────────────────
  const health = await step(
    'Health check',
    () => getJson<{ status: string }>('/health'),
    (r) => (r.status === 'ok' ? null : `Expected status:ok, got ${r.status}`),
  )
  if (!health) return finish()

  // ── 2. Simulate first WhatsApp message → create user ──────────────────
  const sim1 = await step(
    `Simulate WhatsApp message from ${TEST_PHONE}`,
    () =>
      postJson<{ userId: string; isNewUser: boolean; intent: string; response: string }>(
        '/dev/simulate',
        { phone: TEST_PHONE, message: 'Hi' },
      ),
    (r) => {
      if (!r.userId) return 'No userId in response'
      if (!r.isNewUser && process.env['E2E_FRESH'] !== 'false')
        console.log(c.yellow(`       ⚠ User already exists — run with a fresh DB or different phone`))
      return null
    },
  )
  if (!sim1) return finish()

  const userId = sim1.userId
  console.log(c.dim(`       userId: ${userId}`))

  // ── 3. Ask to connect bank → get link ─────────────────────────────────
  const sim2 = await step(
    'Ask "connect my bank" → receive connection link',
    () =>
      postJson<{ response: string; intent: string }>(
        '/agent/chat',
        { userId, message: 'connect my bank' },
        adminAuthHeader(),
      ),
    (r) => {
      if (!r.response.includes('/banking/start?token='))
        return `Expected a /banking/start link, got: ${r.response.slice(0, 120)}`
      if (r.intent !== 'onboarding_help')
        return `Expected intent onboarding_help, got ${r.intent}`
      return null
    },
  )
  if (!sim2) return finish()

  const tokenMatch = sim2.response.match(/token=([0-9a-f]{64})/)
  const token = tokenMatch?.[1]
  if (!token) {
    console.log(c.red('     → Could not extract token from link'))
    failed++
    return finish()
  }
  console.log(c.dim(`       token: ${token.slice(0, 16)}…`))

  // ── 4. Connect mock bank (bypasses OAuth, imports transactions) ────────
  const connect = await step(
    'Connect mock bank via /banking/connect?mock=true',
    () =>
      getJson<{
        connectionId: string
        provider: string
        accountsSynced: number
        transactionsImported: number
        transactionsSkipped: number
      }>(`/banking/connect?mock=true&userId=${userId}`),
    (r) => {
      if (!r.connectionId) return 'No connectionId'
      if (r.accountsSynced < 1) return `Expected ≥1 account, got ${r.accountsSynced}`
      if (r.transactionsImported < 1)
        return `Expected transactions to be imported, got ${r.transactionsImported}`
      return null
    },
  )
  if (!connect) return finish()

  console.log(
    c.dim(
      `       provider: ${connect.provider} · ${connect.accountsSynced} accounts · ${connect.transactionsImported} txns imported`,
    ),
  )

  // ── 5. Database counts ─────────────────────────────────────────────────
  const status = await step(
    'Verify database counts via /dev/status',
    () =>
      getJson<{
        users: number
        bankConnections: number
        accounts: number
        transactions: number
        conversations: number
        auditEvents: number
      }>('/dev/status'),
    (r) => {
      if (r.accounts < 1) return `Expected accounts > 0, got ${r.accounts}`
      if (r.transactions < 1) return `Expected transactions > 0, got ${r.transactions}`
      return null
    },
  )
  if (status) {
    console.log(
      c.dim(
        `       ${status.users} users · ${status.bankConnections} connections · ${status.accounts} accounts · ${status.transactions} txns · ${status.conversations} messages · ${status.auditEvents} audit events`,
      ),
    )
  }

  // ── 6. Spending question ───────────────────────────────────────────────
  const spending = await step(
    'Ask spending question — expect data-driven response',
    () =>
      postJson<{ response: string; intent: string }>(
        '/agent/chat',
        { userId, message: 'How much did I spend this month?' },
        adminAuthHeader(),
      ),
    (r) => {
      if (r.response.toLowerCase().includes('connect'))
        return 'Got "connect bank" response instead of spending data — sync may have failed'
      if (r.intent !== 'spending_analysis')
        return `Expected spending_analysis intent, got ${r.intent}`
      if (!r.response.includes('£'))
        return 'Response does not contain a £ amount — spending data not returned'
      return null
    },
  )
  if (spending) {
    const preview = spending.response.replace(/\n/g, ' ').slice(0, 100)
    console.log(c.dim(`       "${preview}…"`))
  }

  // ── 7. Subscription question ───────────────────────────────────────────
  const subs = await step(
    'Ask subscription question — expect subscriptions listed',
    () =>
      postJson<{ response: string; intent: string }>(
        '/agent/chat',
        { userId, message: 'What subscriptions am I paying for?' },
        adminAuthHeader(),
      ),
    (r) => {
      if (r.response.toLowerCase().includes('connect'))
        return 'Got "connect bank" response — sync may have failed'
      if (r.intent !== 'subscription_detection')
        return `Expected subscription_detection, got ${r.intent}`
      return null
    },
  )
  if (subs) {
    const preview = subs.response.replace(/\n/g, ' ').slice(0, 100)
    console.log(c.dim(`       "${preview}…"`))
  }

  // ── 8. Balance question ────────────────────────────────────────────────
  const balance = await step(
    'Ask balance question — expect account balance shown',
    () =>
      postJson<{ response: string; intent: string }>(
        '/agent/chat',
        { userId, message: "What's my balance?" },
        adminAuthHeader(),
      ),
    (r) => {
      if (r.intent !== 'account_balance')
        return `Expected account_balance, got ${r.intent}`
      if (!r.response.includes('£'))
        return 'Response does not contain a £ balance'
      return null
    },
  )
  if (balance) {
    const preview = balance.response.replace(/\n/g, ' ').slice(0, 100)
    console.log(c.dim(`       "${preview}…"`))
  }

  // ── 9. Admin dashboard ─────────────────────────────────────────────────
  await step(
    'Admin dashboard — authenticated access',
    async () => {
      const res = await get('/admin', adminAuthHeader())
      return res.status
    },
    (status) => (status === 200 ? null : `Expected 200, got ${status}`),
  )

  await step(
    'Admin user detail page',
    async () => {
      const res = await get(`/admin/users/${userId}`, adminAuthHeader())
      return res.status
    },
    (status) => (status === 200 ? null : `Expected 200, got ${status}`),
  )

  await step(
    'Admin transactions page for user',
    async () => {
      const res = await get(`/admin/transactions?userId=${userId}`, adminAuthHeader())
      return res.status
    },
    (status) => (status === 200 ? null : `Expected 200, got ${status}`),
  )

  await step(
    'Admin audit log page',
    async () => {
      const res = await get('/admin/audit', adminAuthHeader())
      return res.status
    },
    (status) => (status === 200 ? null : `Expected 200, got ${status}`),
  )

  // ── 10. Admin 401 guard ────────────────────────────────────────────────
  await step(
    'Admin dashboard — unauthenticated returns 401',
    async () => {
      const res = await get('/admin')
      return res.status
    },
    (status) => (status === 401 ? null : `Expected 401 without auth, got ${status}`),
  )

  finish(userId)
}

function finish(userId?: string) {
  const total = passed + failed
  console.log()
  console.log('─'.repeat(60))

  if (failed === 0) {
    console.log(c.bold(c.green(`  ✅  All ${total} steps passed`)))
  } else {
    console.log(
      c.bold(
        `  ${c.green(`${passed} passed`)}  ${c.red(`${failed} failed`)}  ${c.dim(`of ${total}`)}`,
      ),
    )
  }

  console.log()
  console.log(c.bold('  📋  Manual verification checklist'))
  console.log()

  const checks = [
    `User profile visible at ${BASE_URL}/admin/users${userId ? `/${userId}` : ''}`,
    'Bank connection shows correct provider (mock / truelayer_sandbox)',
    'Accounts listed with current balance',
    'Transactions imported (check count matches above)',
    'Conversation view shows messages with intent badges',
    'AI intent classified correctly for each question',
    'Audit log shows: bank_connect_link_sent, bank_connect_completed',
    'Spending analysis response contains real £ amounts from imported data',
  ]

  for (const check of checks) {
    console.log(`  ${c.dim('□')}  ${check}`)
  }

  console.log()
  console.log(c.dim('  Admin: ') + c.cyan(`${BASE_URL}/admin`))
  if (userId) {
    console.log(c.dim('  User:  ') + c.cyan(`${BASE_URL}/admin/users/${userId}`))
    console.log(c.dim('  Txns:  ') + c.cyan(`${BASE_URL}/admin/transactions?userId=${userId}`))
    console.log(c.dim('  Audit: ') + c.cyan(`${BASE_URL}/admin/audit`))
  }
  console.log()

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(c.red('\nFatal error:'), err)
  process.exit(1)
})
