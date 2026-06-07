import type { PrismaClient } from '@prisma/client'
import { layout } from '../layout.js'

// ── Query helpers ──────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

function pct(num: number, den: number): string {
  if (den === 0) return '—'
  return `${Math.round((num / den) * 100)}%`
}

function fmt(n: number): string {
  return n.toLocaleString('en-GB')
}

function avg(num: number, den: number): string {
  if (den === 0) return '—'
  return (num / den).toFixed(1)
}

// ── Data queries ───────────────────────────────────────────────────────────

interface AnalyticsData {
  // Signups
  signups30d: number
  signups7d: number

  // Bank connection funnel
  bankConnected30d: number
  bankConnectedTotal: number

  // Engagement
  questionsAnswered30d: number
  activeUsersWithQuestions30d: number
  wau: number         // weekly active users (last 7d)
  firstQuestions30d: number

  // Success rates (last 7d)
  syncTotal7d: number
  syncErrors7d: number
  aiResponses7d: number
  aiErrors7d: number

  // Retention: week-2 cohort
  // Users who signed up 8–14 days ago, who also had question_answered in days 8–14
  cohortSignups: number
  cohortRetained: number
}

async function fetchAnalytics(prisma: PrismaClient): Promise<AnalyticsData> {
  const now = new Date()
  const t7  = daysAgo(7)
  const t14 = daysAgo(14)
  const t30 = daysAgo(30)

  // All analytics events — one broad fetch, then filter in JS to avoid many round trips
  const [signupRows, bankRows, questionRows, firstRows, syncRows, syncErrRows, aiErrRows] =
    await Promise.all([
      prisma.auditLog.findMany({
        where: { eventType: 'signup', serviceName: 'analytics', createdAt: { gte: t30 } },
        select: { userId: true, createdAt: true },
        orderBy: { id: 'asc' },
      }),
      prisma.auditLog.findMany({
        where: { eventType: 'bank_connected', serviceName: 'analytics', createdAt: { gte: t30 } },
        select: { userId: true, createdAt: true },
      }),
      prisma.auditLog.findMany({
        where: { eventType: 'question_answered', serviceName: 'analytics', createdAt: { gte: t30 } },
        select: { userId: true, createdAt: true },
      }),
      prisma.auditLog.findMany({
        where: { eventType: 'first_question', serviceName: 'analytics', createdAt: { gte: t30 } },
        select: { userId: true },
      }),
      prisma.auditLog.findMany({
        where: { eventType: 'transaction_sync', serviceName: 'analytics', createdAt: { gte: t7 } },
        select: { id: true },
      }),
      prisma.auditLog.findMany({
        where: { eventType: 'sync_error', serviceName: 'analytics', createdAt: { gte: t7 } },
        select: { id: true },
      }),
      prisma.auditLog.findMany({
        where: { eventType: 'ai_error', serviceName: 'analytics', createdAt: { gte: t7 } },
        select: { id: true },
      }),
    ])

  // Total bank_connected (all time) for overall funnel
  const bankConnectedTotal = await prisma.auditLog.count({
    where: { eventType: 'bank_connected', serviceName: 'analytics' },
  })

  // Signups
  const signups30d = signupRows.length
  const signups7d  = signupRows.filter((r) => r.createdAt >= t7).length

  // Bank connected (30d, distinct users)
  const bankConnected30d = new Set(bankRows.map((r) => r.userId)).size

  // Question engagement (30d)
  const questionsAnswered30d      = questionRows.length
  const activeUsersWithQuestions30d = new Set(questionRows.map((r) => r.userId)).size
  const wau = new Set(questionRows.filter((r) => r.createdAt >= t7).map((r) => r.userId)).size
  const firstQuestions30d = firstRows.length

  // Success rates (7d)
  const syncTotal7d  = syncRows.length + syncErrRows.length
  const syncErrors7d = syncErrRows.length
  const aiResponses7d = questionRows.filter((r) => r.createdAt >= t7).length
  const aiErrors7d    = aiErrRows.length

  // Week-2 retention cohort: signed up 8–14d ago, active in days 8–14
  const cohortSignupRows = signupRows.filter(
    (r) => r.createdAt >= t14 && r.createdAt < t7 && r.userId !== null,
  )
  const cohortUserIds = new Set(cohortSignupRows.map((r) => r.userId))
  const cohortSignups = cohortUserIds.size

  const retainedUserIds = new Set(
    questionRows.filter(
      (r) => r.createdAt >= t14 && r.userId !== null && cohortUserIds.has(r.userId),
    ).map((r) => r.userId),
  )
  const cohortRetained = retainedUserIds.size

  return {
    signups30d,
    signups7d,
    bankConnected30d,
    bankConnectedTotal,
    questionsAnswered30d,
    activeUsersWithQuestions30d,
    wau,
    firstQuestions30d,
    syncTotal7d,
    syncErrors7d,
    aiResponses7d,
    aiErrors7d,
    cohortSignups,
    cohortRetained,
  }
}

// ── HTML rendering ─────────────────────────────────────────────────────────

function statCard(value: string, label: string, sub?: string, color?: string): string {
  const valueColor = color ? `color:${color};` : ''
  return `
    <div class="stat">
      <div class="stat-value" style="${valueColor}">${value}</div>
      <div class="stat-label">${label}</div>
      ${sub ? `<div style="font-size:.75rem;color:#94a3b8;margin-top:.25rem;">${sub}</div>` : ''}
    </div>`
}

function rateBar(num: number, den: number, label: string, goodThreshold = 90): string {
  const rate = den === 0 ? null : Math.round((num / den) * 100)
  const color = rate === null ? '#64748b' : rate >= goodThreshold ? '#22c55e' : rate >= 70 ? '#f59e0b' : '#ef4444'
  const width = rate ?? 0
  return `
    <div style="margin-bottom:1.25rem;">
      <div style="display:flex;justify-content:space-between;margin-bottom:.35rem;">
        <span style="font-size:.875rem;">${label}</span>
        <span style="font-size:.875rem;font-weight:600;color:${color};">${rate !== null ? `${rate}%` : '—'} <span style="font-weight:400;color:#94a3b8;">(${num}/${den})</span></span>
      </div>
      <div style="background:#f1f5f9;border-radius:9999px;height:8px;">
        <div style="background:${color};height:8px;border-radius:9999px;width:${width}%;transition:width .3s;"></div>
      </div>
    </div>`
}

function funnelRow(label: string, count: number, of: number, indent = false): string {
  const rate = of > 0 ? Math.round((count / of) * 100) : null
  return `
    <tr>
      <td>${indent ? '&nbsp;&nbsp;&nbsp;↳ ' : ''}${label}</td>
      <td style="text-align:right;font-weight:600;">${fmt(count)}</td>
      <td style="text-align:right;">${rate !== null ? `${rate}%` : '—'}</td>
    </tr>`
}

export async function analyticsPage(prisma: PrismaClient): Promise<string> {
  const d = await fetchAnalytics(prisma)

  const body = `
    <div class="card">
      <div class="card-title">Growth — last 30 days</div>
      <div class="stats" style="margin-bottom:0;">
        ${statCard(fmt(d.signups30d), 'Sign-ups', `${fmt(d.signups7d)} this week`)}
        ${statCard(fmt(d.bankConnected30d), 'Bank connected', `${pct(d.bankConnected30d, d.signups30d)} of sign-ups`)}
        ${statCard(fmt(d.firstQuestions30d), 'Asked first question', `${pct(d.firstQuestions30d, d.bankConnected30d)} of connected`)}
        ${statCard(fmt(d.activeUsersWithQuestions30d), 'Active users', 'with ≥1 question (30d)')}
        ${statCard(fmt(d.wau), 'Weekly active users', 'last 7 days')}
        ${statCard(avg(d.questionsAnswered30d, d.activeUsersWithQuestions30d), 'Avg questions / user', '30-day cohort')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
      <div class="card">
        <div class="card-title">Activation funnel (30d)</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Stage</th><th style="text-align:right;">Users</th><th style="text-align:right;">Rate</th></tr></thead>
            <tbody>
              ${funnelRow('Sign-up', d.signups30d, d.signups30d)}
              ${funnelRow('Bank connected', d.bankConnected30d, d.signups30d, true)}
              ${funnelRow('First question', d.firstQuestions30d, d.bankConnected30d, true)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Week-2 retention</div>
        <p style="font-size:.8rem;color:#64748b;margin-bottom:1rem;">
          Users who signed up 8–14 days ago and asked a question in the same window.
        </p>
        <div style="text-align:center;padding:1rem 0;">
          <div style="font-size:3rem;font-weight:700;color:${d.cohortSignups === 0 ? '#94a3b8' : d.cohortRetained / d.cohortSignups >= .4 ? '#22c55e' : '#f59e0b'};">
            ${pct(d.cohortRetained, d.cohortSignups)}
          </div>
          <div style="font-size:.875rem;color:#64748b;margin-top:.5rem;">
            ${fmt(d.cohortRetained)} / ${fmt(d.cohortSignups)} users retained
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">System health — last 7 days</div>
      ${rateBar(d.syncTotal7d - d.syncErrors7d, d.syncTotal7d, 'Bank sync success rate', 95)}
      ${rateBar(d.aiResponses7d, d.aiResponses7d + d.aiErrors7d, 'AI response success rate', 95)}
    </div>
  `

  return layout('Product Analytics', body, [
    { label: 'Admin', href: '/admin' },
    { label: 'Analytics' },
  ])
}
