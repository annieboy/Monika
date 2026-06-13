/**
 * Renders WhatsApp message templates for each offer category.
 *
 * Rules:
 * - WhatsApp max message length: 4096 chars. All templates are well under that.
 * - Every message MUST include a category-appropriate FCA disclaimer.
 * - Language must be informational, never advisory ("could save" not "you should").
 * - Short affiliate link is appended after template body.
 * - Proactive outreach messages include a YES/NO/STOP reply menu.
 */

export interface BuiltMessage {
  body: string          // full WhatsApp message text
  category: string      // used for logging + frequency cap
}

export interface OpportunityContext {
  categorySlug: string
  providerName: string
  title: string
  shortDescription: string
  keyBenefits: string[]
  parameters: Record<string, unknown>
  annualSavingEstimate: number | null
  currentMonthlySpend?: number | undefined  // from RecurringPayment, if available
  affiliateUrl: string          // short link e.g. monika.app/r/xK9mPqRt
  fcaDisclaimer?: string | null
}

// ── Disclaimer library ──────────────────────────────────────────────────────

const DISCLAIMERS: Record<string, string> = {
  savings:
    '⚠️ _Information only, not financial advice. Rates are variable and may change. Eligible deposits protected up to £85,000 per institution under the FSCS. Always read full T&Cs._',
  broadband:
    '⚠️ _Information only, not financial advice. Check coverage at your address before switching. Early termination charges may apply with your current provider._',
  mobile:
    '⚠️ _Information only, not financial advice. Check network coverage before switching. Early termination charges may apply._',
  'business-banking':
    '⚠️ _Information only, not financial advice. Business accounts may not have the same FSCS protections as personal accounts. Always check the full terms._',
  accounting:
    '⚠️ _Information only, not financial advice. Pricing and features may change. Always verify the latest terms on the provider\'s website._',
}

function disclaimer(categorySlug: string, custom?: string | null): string {
  return custom ?? DISCLAIMERS[categorySlug] ?? '⚠️ _Information only, not financial advice. Always read full T&Cs before switching._'
}

// ── Proactive outreach messages (sent by Monika unprompted) ────────────────

function buildSavingsOutreach(ctx: OpportunityContext): string {
  const savingStr = ctx.annualSavingEstimate
    ? `~£${Math.round(ctx.annualSavingEstimate).toLocaleString()}/year`
    : 'more interest each year'

  return [
    `💰 *Savings opportunity*`,
    ``,
    `I can see money sitting in your current account earning almost no interest.`,
    ``,
    `*${ctx.providerName}* currently offers ${ctx.shortDescription}.`,
    `Potential gain: ${savingStr}`,
    ``,
    `Reply:`,
    `*1* — Show me more`,
    `*2* — Not interested`,
    `*STOP* — Don't send me these`,
    ``,
    disclaimer(ctx.categorySlug, ctx.fcaDisclaimer),
  ].join('\n')
}

function buildBroadbandOutreach(ctx: OpportunityContext): string {
  const params = ctx.parameters as { monthlyPrice?: number; speedMbps?: number; contractMonths?: number }
  const saving = ctx.annualSavingEstimate ? `£${Math.round(ctx.annualSavingEstimate)}/year` : null
  const lines = [
    `📡 *Broadband switching opportunity*`,
    ``,
  ]
  if (ctx.currentMonthlySpend) {
    lines.push(`You appear to be paying around *£${ctx.currentMonthlySpend.toFixed(0)}/month* for broadband.`)
    lines.push(``)
  }
  lines.push(`*${ctx.providerName}* offers ${params.speedMbps ?? '?'}Mbps for *£${params.monthlyPrice ?? '?'}/month*.`)
  if (saving) lines.push(`Potential saving: *${saving}*`)
  lines.push(``, `Reply:`, `*1* — Show me the deal`, `*2* — I'm happy where I am`, `*3* — Show more options`, ``, disclaimer(ctx.categorySlug, ctx.fcaDisclaimer))
  return lines.join('\n')
}

function buildMobileOutreach(ctx: OpportunityContext): string {
  const params = ctx.parameters as { monthlyPrice?: number; dataGb?: number | string; contractMonths?: number }
  const saving = ctx.annualSavingEstimate ? `£${Math.round(ctx.annualSavingEstimate)}/year` : null
  const dataStr = params.dataGb === 'unlimited' ? 'unlimited data' : `${params.dataGb}GB data`
  const lines = [
    `📱 *Mobile switching opportunity*`,
    ``,
  ]
  if (ctx.currentMonthlySpend) {
    lines.push(`Your mobile bill looks like around *£${ctx.currentMonthlySpend.toFixed(0)}/month*.`)
    lines.push(``)
  }
  lines.push(`*${ctx.providerName}* offers ${dataStr} for *£${params.monthlyPrice ?? '?'}/month* (${params.contractMonths ?? 24}-month SIM-only).`)
  if (saving) lines.push(`Potential saving: *${saving}*`)
  lines.push(``, `Reply:`, `*1* — Tell me more`, `*2* — No thanks`, `*3* — I'm in a contract, remind me later`, ``, disclaimer(ctx.categorySlug, ctx.fcaDisclaimer))
  return lines.join('\n')
}

function buildBusinessBankingOutreach(ctx: OpportunityContext): string {
  const params = ctx.parameters as { monthlyFee?: number; freeTransactionMonths?: number }
  const feeStr = params.monthlyFee === 0 ? 'free plan available' : `£${params.monthlyFee}/month`
  return [
    `🏦 *Business banking opportunity*`,
    ``,
    `If you run a business, you might be paying more for banking than you need to.`,
    ``,
    `*${ctx.providerName}* offers ${ctx.shortDescription} (${feeStr}).`,
    `Many traditional banks charge £8–15/month plus transaction fees.`,
    ``,
    `Reply:`,
    `*1* — Yes, I run a business`,
    `*2* — No, personal use only`,
    ``,
    disclaimer(ctx.categorySlug, ctx.fcaDisclaimer),
  ].join('\n')
}

function buildAccountingOutreach(ctx: OpportunityContext): string {
  const params = ctx.parameters as { monthlyPrice?: number; tier?: string; trialDays?: number }
  const trialStr = params.trialDays ? ` (${params.trialDays}-day free trial)` : ''
  return [
    `📊 *Accounting software opportunity*`,
    ``,
    `*${ctx.providerName}* ${params.tier ? `(${params.tier})` : ''} offers ${ctx.shortDescription} at *£${params.monthlyPrice ?? '?'}/month*${trialStr}.`,
    ``,
    `Reply:`,
    `*1* — Tell me more`,
    `*2* — I'm happy with my current software`,
    `*3* — What's the difference vs others?`,
    ``,
    disclaimer(ctx.categorySlug, ctx.fcaDisclaimer),
  ].join('\n')
}

// ── Detail messages (sent after user replies "1" / "YES") ──────────────────

export function buildDetailMessage(ctx: OpportunityContext): string {
  const lines: string[] = []

  switch (ctx.categorySlug) {
    case 'savings': {
      const p = ctx.parameters as { aer?: number; accessType?: string; minDeposit?: number; maxDeposit?: number; fscsProtected?: boolean }
      lines.push(`*${ctx.title}*`, ``)
      lines.push(`• Rate: *${p.aer ?? '?'}% AER* (${p.accessType === 'easy_access' ? 'variable, no lock-in' : p.accessType ?? 'fixed'})`)
      lines.push(`• Min deposit: £${p.minDeposit ?? 1}`)
      if (p.maxDeposit) lines.push(`• Max deposit: £${p.maxDeposit.toLocaleString()}`)
      lines.push(`• FSCS protected: ${p.fscsProtected ? '✅ Yes' : '❌ No'}`)
      if (ctx.annualSavingEstimate) lines.push(``, `Your potential gain: *~£${Math.round(ctx.annualSavingEstimate).toLocaleString()}/year*`)
      lines.push(``, `[Apply now → ${ctx.affiliateUrl}]`)
      break
    }
    case 'broadband': {
      const p = ctx.parameters as { speedMbps?: number; monthlyPrice?: number; setupFee?: number; contractMonths?: number; technology?: string }
      lines.push(`*${ctx.title}*`, ``)
      lines.push(`• Speed: *${p.speedMbps ?? '?'}Mbps* average`)
      lines.push(`• Price: *£${p.monthlyPrice ?? '?'}/month* (incl. line rental)`)
      lines.push(`• Setup fee: £${p.setupFee ?? 0}`)
      lines.push(`• Contract: ${p.contractMonths ?? 24} months`)
      if (p.technology) lines.push(`• Technology: ${p.technology.toUpperCase()}`)
      if (ctx.annualSavingEstimate) lines.push(``, `Estimated saving vs current: *£${Math.round(ctx.annualSavingEstimate)}/year*`)
      lines.push(``, `[Check availability & apply → ${ctx.affiliateUrl}]`)
      break
    }
    case 'mobile': {
      const p = ctx.parameters as { dataGb?: number | string; monthlyPrice?: number; contractMonths?: number; network?: string }
      const dataStr = p.dataGb === 'unlimited' ? 'Unlimited data' : `${p.dataGb}GB data`
      lines.push(`*${ctx.title}*`, ``)
      lines.push(`• Data: *${dataStr}*`)
      lines.push(`• Price: *£${p.monthlyPrice ?? '?'}/month*`)
      lines.push(`• Contract: ${p.contractMonths ?? 24} months (SIM-only)`)
      if (p.network) lines.push(`• Network: ${p.network}`)
      if (ctx.annualSavingEstimate) lines.push(``, `Estimated saving: *£${Math.round(ctx.annualSavingEstimate)}/year*`)
      lines.push(``, `[View deal → ${ctx.affiliateUrl}]`)
      break
    }
    case 'business-banking': {
      const p = ctx.parameters as { monthlyFee?: number; freeTransactionMonths?: number; overdraftAvailable?: boolean }
      lines.push(`*${ctx.title}*`, ``)
      lines.push(`• Monthly fee: *${p.monthlyFee === 0 ? 'Free' : `£${p.monthlyFee}`}*`)
      if (p.freeTransactionMonths) lines.push(`• Free transactions: ${p.freeTransactionMonths} months`)
      lines.push(`• Overdraft: ${p.overdraftAvailable ? '✅ Available' : '❌ Not available'}`)
      for (const benefit of ctx.keyBenefits.slice(0, 3)) lines.push(`• ${benefit}`)
      lines.push(``, `[Apply now → ${ctx.affiliateUrl}]`)
      break
    }
    case 'accounting': {
      const p = ctx.parameters as { monthlyPrice?: number; tier?: string; trialDays?: number; features?: string[] }
      lines.push(`*${ctx.title}*`, ``)
      lines.push(`• Price: *£${p.monthlyPrice ?? '?'}/month*`)
      if (p.tier) lines.push(`• Plan: ${p.tier}`)
      if (p.trialDays) lines.push(`• Free trial: ${p.trialDays} days`)
      for (const f of (p.features ?? []).slice(0, 4)) lines.push(`• ✅ ${f}`)
      lines.push(``, p.trialDays ? `[Start free trial → ${ctx.affiliateUrl}]` : `[Learn more → ${ctx.affiliateUrl}]`)
      break
    }
    default:
      lines.push(`*${ctx.title}*`, ``, ctx.shortDescription, ``, `[View offer → ${ctx.affiliateUrl}]`)
  }

  lines.push(``, disclaimer(ctx.categorySlug, ctx.fcaDisclaimer))
  return lines.join('\n')
}

// ── Public builder ──────────────────────────────────────────────────────────

export function buildOutreachMessage(ctx: OpportunityContext): BuiltMessage {
  let body: string

  switch (ctx.categorySlug) {
    case 'savings':          body = buildSavingsOutreach(ctx); break
    case 'broadband':        body = buildBroadbandOutreach(ctx); break
    case 'mobile':           body = buildMobileOutreach(ctx); break
    case 'business-banking': body = buildBusinessBankingOutreach(ctx); break
    case 'accounting':       body = buildAccountingOutreach(ctx); break
    default:
      body = [
        `💡 *${ctx.title}*`,
        ``,
        ctx.shortDescription,
        ctx.annualSavingEstimate ? `Potential saving: £${Math.round(ctx.annualSavingEstimate)}/year` : '',
        ``,
        `Reply *1* for details or *2* to dismiss.`,
        ``,
        disclaimer(ctx.categorySlug, ctx.fcaDisclaimer),
      ].filter(Boolean).join('\n')
  }

  return { body, category: ctx.categorySlug }
}

// ── Opt-in consent prompt ───────────────────────────────────────────────────

export const CONSENT_PROMPT = [
  `👋 *One quick thing!*`,
  ``,
  `I've spotted some potential savings based on your spending. Want me to occasionally share personalised money-saving opportunities?`,
  ``,
  `I'll only send things relevant to your actual transactions — max 2 a week.`,
  ``,
  `Reply:`,
  `*YES* — Send me opportunities`,
  `*NO* — No thanks`,
  ``,
  `⚠️ _This is information only, not financial advice. Reply STOP at any time to opt out._`,
].join('\n')

export const CONSENT_CONFIRMED = [
  `✅ Great! I'll be in touch when I spot something worth sharing.`,
  ``,
  `Reply *STOP* at any time to opt out.`,
].join('\n')

export const CONSENT_DECLINED = `No problem! I won't send you savings suggestions. You can always ask me about deals directly anytime.`
