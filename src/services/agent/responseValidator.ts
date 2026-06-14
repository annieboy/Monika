export const FCA_DISCLAIMER =
  '⚠️ _This is an estimate only and not financial advice. For decisions about mortgages, savings, or large purchases, please consult a qualified financial adviser._'

export interface ValidatorOptions {
  toolsUsed?: string[]
  dataContext?: string
}

export interface ValidationResult {
  text: string
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip currency symbols and commas from a raw number token and return a
 *  normalised numeric string, e.g. "£1,234.56" → "1234.56" */
function normaliseNumber(raw: string): string {
  return raw.replace(/[£$€,]/g, '')
}

/** Extract all number-like tokens from a piece of text. */
function extractNumbers(text: string): string[] {
  const matches = text.match(/[£$€]?\d[\d,]*(?:\.\d+)?/g) ?? []
  return matches.map(normaliseNumber).filter((n) => n !== '')
}

// ---------------------------------------------------------------------------
// Step 1 – Number hallucination guard
// ---------------------------------------------------------------------------

function runHallucinationGuard(
  text: string,
  dataContext: string,
  warnings: string[],
): string {
  const contextNumbers = new Set(extractNumbers(dataContext))
  // If context has no numbers at all, skip (nothing to verify against)
  if (contextNumbers.size === 0) return text

  const result = text.replace(/[£$€]?\d[\d,]*(?:\.\d+)?/g, (match) => {
    const normalised = normaliseNumber(match)
    if (!contextNumbers.has(normalised)) {
      warnings.push(
        `Hallucination guard: number "${match}" not found in data context — replaced`,
      )
      return '[unverified figure]'
    }
    return match
  })

  return result
}

// ---------------------------------------------------------------------------
// Step 2 – FCA disclaimer injection
// ---------------------------------------------------------------------------

const FCA_TRIGGER_INTENTS = new Set(['affordability_question', 'safe_to_spend'])

function runFcaDisclaimerInjection(text: string, toolsUsed: string[]): string {
  const requiresDisclaimer = toolsUsed.some((t) => FCA_TRIGGER_INTENTS.has(t))
  if (!requiresDisclaimer) return text
  if (text.includes(FCA_DISCLAIMER)) return text
  return `${text}\n\n${FCA_DISCLAIMER}`
}

// ---------------------------------------------------------------------------
// Step 3 – Sensitive data redaction
// ---------------------------------------------------------------------------

interface SensitivePattern {
  name: string
  pattern: RegExp
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // Full IBAN (must come before shorter numeric patterns)
  { name: 'IBAN', pattern: /\bGB\d{2}[A-Z]{4}\d{14}\b/g },
  // Card numbers (13-16 digits) — before 8-digit account number check
  { name: 'card number', pattern: /\b\d{13,16}\b/g },
  // 8-digit account number
  { name: 'account number', pattern: /\b\d{8}\b/g },
  // Sort code with hyphens
  { name: 'sort code', pattern: /\b\d{2}-\d{2}-\d{2}\b/g },
  // 6-digit sort code (no hyphens)
  { name: 'sort code', pattern: /\b\d{6}\b/g },
]

function runSensitiveDataScan(text: string, warnings: string[]): string {
  let result = text
  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, (match) => {
      warnings.push(
        `Sensitive data redacted: ${name} pattern matched ("${match}")`,
      )
      return '[REDACTED]'
    })
    pattern.lastIndex = 0
  }
  return result
}

// ---------------------------------------------------------------------------
// Step 4 – WhatsApp formatter
// ---------------------------------------------------------------------------

function runWhatsAppFormatter(text: string): string {
  let result = text

  // Convert **bold** → *bold*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*')

  // Convert # Header lines → *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

  // Convert --- separator lines to blank lines
  result = result.replace(/^-{3,}$/gm, '')

  // Collapse more than 2 consecutive newlines
  result = result.replace(/\n{3,}/g, '\n\n')

  // Truncate to 4096 chars
  const LIMIT = 4096
  if (result.length > LIMIT) {
    const suffix = '\n\n_[Message truncated]_'
    result = result.slice(0, LIMIT - suffix.length) + suffix
  }

  return result
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function validateAndFormatResponse(
  rawText: string,
  opts?: ValidatorOptions,
): ValidationResult {
  const warnings: string[] = []
  const toolsUsed = opts?.toolsUsed ?? []
  const dataContext = opts?.dataContext

  let text = rawText

  // 1. Hallucination guard (only when dataContext is provided and non-empty)
  if (dataContext !== undefined && dataContext.trim() !== '') {
    text = runHallucinationGuard(text, dataContext, warnings)
  }

  // 2. FCA disclaimer injection
  text = runFcaDisclaimerInjection(text, toolsUsed)

  // 3. Sensitive data redaction
  text = runSensitiveDataScan(text, warnings)

  // 4. WhatsApp formatting
  text = runWhatsAppFormatter(text)

  return { text, warnings }
}
