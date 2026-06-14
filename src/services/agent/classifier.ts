import type { ClassificationResult, Intent } from './intents.js'
import { buildClassificationPrompt, parseClassificationResponse } from './prompts.js'

// ── Deterministic rules ────────────────────────────────────────────────────
// Ordered from most-specific to least-specific. First match wins.

interface Rule {
  intent: Intent
  patterns: RegExp[]
}

const RULES: Rule[] = [
  {
    intent: 'subscription_detection',
    patterns: [
      /subscri/i,
      /recurring/i,
      /direct\s*debit/i,
      /standing\s*order/i,
      /membership/i,
      /\bnetflix\b|\bspotify\b|\bamazon\s*prime\b|\bdisney\b|\bapple\s*tv\b|\bgym\b/i,
      /what.*paying\s+for/i,
      /am\s+i\s+paying\s+for/i,
    ],
  },
  {
    intent: 'payment_request',
    patterns: [
      /\bpay\b.*\bto\b/i,
      /\btransfer\b/i,
      /\bsend\s+(money|funds|£|\$)/i,
      /\bmake\s+a\s+payment/i,
      /\bpay\s+(someone|a\s+bill|my\s+rent|my\s+mortgage)/i,
      /\bset\s+up\s+(a\s+)?payment/i,
      /\bbank\s+transfer\b/i,
      /\bpay\s+£\d/i,
    ],
  },
  {
    intent: 'merchant_query',
    patterns: [
      /how\s+much\s+(have\s+i\s+spent?\s+at|did\s+i\s+spend\s+at|do\s+i\s+spend\s+at)/i,
      /how\s+much\s+(have\s+i\s+spent?\s+on|did\s+i\s+spend\s+on)\s+(amazon|tesco|sainsbury|waitrose|deliveroo|uber|spotify|netflix|apple|google|paypal)/i,
      /\bspend\s+at\b/i,
      /\bspent\s+at\b/i,
    ],
  },
  {
    intent: 'income_query',
    patterns: [
      /when\s+(does|is|will)\s+(my\s+)?(salary|pay|wage|income|paycheck)/i,
      /when\s+do\s+i\s+get\s+paid/i,
      /how\s+much\s+(do\s+i\s+earn|is\s+my\s+salary|am\s+i\s+earning)/i,
      /my\s+(salary|income|wages?|earnings?|pay)/i,
      /next\s+payday/i,
      /\bpayday\b/i,
    ],
  },
  {
    intent: 'savings_query',
    patterns: [
      /how\s+much\s+(have\s+i\s+saved|am\s+i\s+saving|did\s+i\s+save)/i,
      /am\s+i\s+saving\s+enough/i,
      /savings?\s+(rate|goal|target)/i,
      /could\s+i\s+save\s+more/i,
      /how\s+much\s+could\s+i\s+save/i,
    ],
  },
  {
    intent: 'savings_goal',
    patterns: [
      /i\s+want\s+to\s+save/i,
      /set\s+(?:a\s+)?savings?\s+goal/i,
      /saving\s+(?:up\s+)?for/i,
      /save\s+(?:up\s+)?for/i,
      /my\s+savings?\s+goals?/i,
      /savings?\s+target/i,
      /how\s+am\s+i\s+doing\s+on\s+my\s+goal/i,
    ],
  },
  {
    intent: 'upcoming_bills',
    patterns: [
      /upcoming\s+bills?/i,
      /bills?\s+due/i,
      /what.*due\s+(this|next)\s+month/i,
      /direct\s+debits?\s+due/i,
      /what.*owe\s+this\s+month/i,
      /payments?\s+due/i,
    ],
  },
  {
    intent: 'safe_to_spend',
    patterns: [
      /safe\s+to\s+spend/i,
      /how\s+much\s+can\s+i\s+spend/i,
      /can\s+i\s+spend/i,
      /spend\s+this\s+(weekend|week|month)/i,
      /this\s+weekend/i,
      /spare\s+(cash|money)/i,
      /left\s+to\s+spend/i,
      /spending\s+money/i,
    ],
  },
  {
    intent: 'affordability_question',
    patterns: [
      /can\s+i\s+afford/i,
      /afford/i,
      /mortgage/i,
      /will\s+i\s+(have|be\s+able)/i,
      /have\s+enough/i,
      /budget\s+(for|next)/i,
      /next\s+month.*can\s+i/i,
    ],
  },
  {
    intent: 'unusual_spending',
    patterns: [
      /unusual/i,
      /weird/i,
      /strange/i,
      /unexpected/i,
      /anomal/i,
      /spike/i,
      /suspicious/i,
      /out\s+of\s+the\s+ordinary/i,
    ],
  },
  {
    intent: 'account_balance',
    patterns: [
      /\bbalance\b/i,
      /how\s+much\s+(do\s+i\s+have|money|is\s+in)/i,
      /what.*in\s+my\s+account/i,
      /available\s+funds/i,
      /\bfunds\b/i,
      /how\s+much\s+.*left/i,
    ],
  },
  {
    intent: 'spending_analysis',
    patterns: [
      /how\s+much\s+(did|have)\s+i\s+(spend|spent)/i,
      /spent\s+on/i,
      /spend\s+on/i,
      /spending\s+on/i,
      /groceries|supermarket|eating\s+out|restaurants?|transport|fuel|clothes/i,
      /last\s+(week|month|year)/i,
      /this\s+month.*spend/i,
      /spend.*this\s+month/i,
      /my\s+spending/i,
      /expenses?/i,
      /outgoings/i,
      /transactions/i,
    ],
  },
  {
    intent: 'budget',
    patterns: [
      /set\s+(?:a\s+|my\s+)?(?:£[\d,]+\s+)?budget\s+(?:for|to)/i,
      /budget\s+(?:£[\d,]+\s+for|for\s+my)/i,
      /£[\d,]+\s+(?:budget|limit)\s+for/i,
      /my\s+budgets?/i,
      /show\s+(?:me\s+)?(?:my\s+)?budgets?/i,
      /what(?:'s|\s+is)\s+my\s+\w+\s+budget/i,
      /spending\s+limit/i,
    ],
  },
  {
    intent: 'spending_trends',
    patterns: [
      /how\s+is\s+my\s+spending\s+trending/i,
      /spending\s+trend/i,
      /trending\s+up\s+on/i,
      /am\s+i\s+spending\s+more/i,
      /spending\s+going\s+up/i,
      /categories?\s+(going|trending)\s+up/i,
    ],
  },
  {
    intent: 'net_worth',
    patterns: [
      /net\s+worth/i,
      /what\s+am\s+i\s+worth/i,
      /how\s+much\s+am\s+i\s+worth/i,
      /total\s+(assets?|wealth)/i,
      /assets?\s+(vs?|versus|minus)\s+liabilit/i,
      /overall\s+financial\s+position/i,
    ],
  },
  {
    intent: 'account_management',
    patterns: [
      /stop\s+(sending|messages|offers|notifications|tips)/i,
      /unsubscribe/i,
      /opt\s*out/i,
      /delete\s+(my\s+)?(account|data)/i,
      /remove\s+(my\s+)?(account|data)/i,
      /what\s+data\s+(do\s+you|have\s+you)\s+(hold|have|store|collect)/i,
      /my\s+(personal\s+)?data/i,
      /right\s+to\s+be\s+forgotten/i,
      /gdpr/i,
      /privacy/i,
      /change\s+my\s+name/i,
      /update\s+my\s+(name|details|profile)/i,
      /what('?s|\s+is)\s+my\s+name/i,
      /my\s+(account|profile)\s+(settings?|details?|info)/i,
    ],
  },
  {
    intent: 'onboarding_help',
    patterns: [
      /how\s+do\s+i\s+(connect|link|start|use|get\s+started)/i,
      /connect\s+(my\s+)?(bank|account)/i,
      /link\s+(my\s+)?(bank|account)/i,
      /get\s+started/i,
      /what\s+can\s+you\s+do/i,
      /what\s+is\s+monika/i,
      /help\s+me/i,
      /\bhelp\b/i,
    ],
  },
]

function applyRules(text: string): { intent: Intent; matched: boolean } {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { intent: rule.intent, matched: true }
    }
  }
  return { intent: 'unknown', matched: false }
}

// ── LLM path (optional — only when ANTHROPIC_API_KEY is configured) ─────────

async function classifyWithLlm(
  message: string,
  apiKey: string,
): Promise<{ intent: Intent; confidence: 'high' | 'low' } | null> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 64,
        messages: [{ role: 'user', content: buildClassificationPrompt(message) }],
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>
    }
    const text = data.content.find((b) => b.type === 'text')?.text ?? ''
    return parseClassificationResponse(text)
  } catch {
    return null
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function classifyIntent(
  message: string,
  anthropicApiKey = '',
): Promise<ClassificationResult> {
  // Always run rules first — they're free, fast, and highly reliable for
  // the explicit patterns in our acceptance criteria.
  const { intent: ruleIntent, matched } = applyRules(message)

  if (matched) {
    return { intent: ruleIntent, confidence: 'high', method: 'rules' }
  }

  // Rules didn't match — try the LLM if a key is available.
  if (anthropicApiKey) {
    const llmResult = await classifyWithLlm(message, anthropicApiKey)
    if (llmResult) {
      return { ...llmResult, method: 'llm' }
    }
  }

  return { intent: 'unknown', confidence: 'high', method: 'rules' }
}
