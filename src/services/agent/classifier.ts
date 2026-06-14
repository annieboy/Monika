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
    intent: 'financial_health',
    patterns: [
      /financial\s+health/i,
      /how\s+(am\s+i\s+doing\s+financially|is\s+my\s+financial\s+health)/i,
      /my\s+financial\s+score/i,
      /money\s+health/i,
      /overall\s+financial\s+(position|health|status)/i,
    ],
  },
  {
    intent: 'spending_forecast',
    patterns: [
      /how\s+much\s+will\s+i\s+spend\s+(this|by\s+end\s+of)\s+month/i,
      /spending\s+forecast/i,
      /projected?\s+spend/i,
      /on\s+track\s+(for|to\s+spend)/i,
      /end\s+of\s+month\s+spend/i,
      /how\s+much\s+am\s+i\s+on\s+track\s+to\s+spend/i,
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
    intent: 'fx_transactions',
    patterns: [
      /foreign\s+(currency|transaction|charge)/i,
      /fx\s+(fee|charge|transaction)/i,
      /travel\s+(spending|transactions?|expenses?)/i,
      /currency\s+(fee|charge|conversion)/i,
      /how\s+much\s+(did\s+i\s+spend|have\s+i\s+spent)\s+(abroad|overseas|on\s+holiday)/i,
      /international\s+(transaction|charge|fee)/i,
      /non[\s-]sterling/i,
    ],
  },
  {
    intent: 'charity_tracker',
    patterns: [
      /charit(y|ies|able)/i,
      /donation|donate/i,
      /gift\s+aid/i,
      /how\s+much\s+(have\s+i\s+donated|did\s+i\s+give)/i,
      /justgiving|gofundme/i,
      /charitable\s+giving/i,
    ],
  },
  {
    intent: 'category_deep_dive',
    patterns: [
      /breakdown\s+(of|for)\s+(my\s+)?(groceries|transport|eating\s+out|food|entertainment|shopping|fuel|travel|bills)/i,
      /detail(ed)?\s+(spending|breakdown)\s+(on|for)/i,
      /more\s+detail(s)?\s+(on|about)\s+my\s+\w+\s+spending/i,
      /drill\s+down\s+(into|on)/i,
      /deep\s+dive/i,
    ],
  },
  {
    intent: 'savings_simulation',
    patterns: [
      /if\s+i\s+(save|cut|reduce|put\s+aside)/i,
      /how\s+long\s+(to|would\s+it\s+take)\s+(to\s+)?save/i,
      /how\s+many\s+months\s+(to|until)\s+(i\s+)?save/i,
      /when\s+would\s+i\s+(reach|hit|have)\s+£/i,
      /saving\s+£[\d,]+\s*(?:\/|per|a)\s+month/i,
      /cut\s+[\w\s]+\s+by\s+£/i,
    ],
  },
  {
    intent: 'duplicate_detection',
    patterns: [
      /duplicate\s+(charge|transaction|payment)/i,
      /charged\s+twice/i,
      /double[\s-]charged/i,
      /same\s+(charge|transaction|payment)\s+twice/i,
      /been\s+charged\s+twice/i,
      /duplicate\s+transactions?/i,
    ],
  },
  {
    intent: 'tax_year_summary',
    patterns: [
      /tax\s+year/i,
      /self[\s-]assess/i,
      /hmrc/i,
      /tax\s+return/i,
      /annual\s+(income|spending|summary)/i,
      /business\s+expenses?/i,
      /how\s+much\s+(did\s+i\s+earn|have\s+i\s+earned)\s+(this|last)\s+year/i,
    ],
  },
  {
    intent: 'cash_flow',
    patterns: [
      /cash\s+flow/i,
      /will\s+i\s+(run\s+out|have\s+enough)\s+(of\s+)?money/i,
      /can\s+i\s+make\s+it\s+to\s+payday/i,
      /shortfall/i,
      /projected\s+balance/i,
      /before\s+(my\s+)?next\s+payday/i,
      /how\s+long\s+will\s+my\s+money\s+last/i,
    ],
  },
  {
    intent: 'transaction_search',
    patterns: [
      /show\s+(me\s+)?my\s+transactions/i,
      /find\s+(my\s+)?transactions?/i,
      /list\s+(my\s+)?transactions?/i,
      /search\s+(my\s+)?transactions?/i,
      /transactions?\s+(at|from|on)\s+/i,
      /what\s+did\s+i\s+(buy|purchase|pay\s+for)/i,
      /recent\s+transactions?/i,
      /show\s+(me\s+)?purchases?/i,
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
