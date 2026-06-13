/**
 * buildClassificationPrompt and parseClassificationResponse tests.
 *
 * buildClassificationPrompt: message embedding, intent listing, quote escaping.
 * parseClassificationResponse: valid JSON, invalid intent, missing JSON,
 *   confidence normalisation, embedded prose, extra fields.
 */
import { describe, it, expect } from 'vitest'
import { buildClassificationPrompt, parseClassificationResponse } from '../prompts.js'
import { INTENTS } from '../intents.js'

// ── buildClassificationPrompt ─────────────────────────────────────────────────

describe('buildClassificationPrompt', () => {
  it('includes the user message verbatim', () => {
    const p = buildClassificationPrompt('how much did I spend on groceries?')
    expect(p).toContain('how much did I spend on groceries?')
  })

  it('lists every intent defined in INTENTS', () => {
    const p = buildClassificationPrompt('test')
    for (const intent of INTENTS) {
      expect(p).toContain(intent)
    }
  })

  it('escapes double quotes in the user message to prevent prompt injection', () => {
    const p = buildClassificationPrompt('She said "hello" to me')
    expect(p).toContain('\\"hello\\"')
  })

  it('produces a non-empty string for any input', () => {
    expect(buildClassificationPrompt('').length).toBeGreaterThan(0)
    expect(buildClassificationPrompt('x').length).toBeGreaterThan(10)
  })

  it('instructs the model to respond with a JSON object', () => {
    const p = buildClassificationPrompt('test')
    expect(p).toContain('JSON')
  })
})

// ── parseClassificationResponse ───────────────────────────────────────────────

describe('parseClassificationResponse', () => {
  it('parses a valid high-confidence response', () => {
    const result = parseClassificationResponse('{"intent": "spending_analysis", "confidence": "high"}')
    expect(result).toEqual({ intent: 'spending_analysis', confidence: 'high' })
  })

  it('parses low confidence', () => {
    const result = parseClassificationResponse('{"intent": "unknown", "confidence": "low"}')
    expect(result).toEqual({ intent: 'unknown', confidence: 'low' })
  })

  it('defaults to low for any confidence value that is not "high"', () => {
    const result = parseClassificationResponse('{"intent": "income_query", "confidence": "medium"}')
    expect(result?.confidence).toBe('low')
  })

  it('returns null for an intent not in the INTENTS list', () => {
    const result = parseClassificationResponse('{"intent": "buy_crypto", "confidence": "high"}')
    expect(result).toBeNull()
  })

  it('returns null when no JSON object is present in the response', () => {
    expect(parseClassificationResponse('Sorry, I cannot classify that.')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseClassificationResponse('')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseClassificationResponse('{intent: spending_analysis}')).toBeNull()
  })

  it('handles JSON embedded inside prose', () => {
    const result = parseClassificationResponse(
      'The intent is: {"intent": "account_balance", "confidence": "high"} — done.',
    )
    expect(result).toEqual({ intent: 'account_balance', confidence: 'high' })
  })

  it('ignores extra fields in the JSON object', () => {
    const result = parseClassificationResponse(
      '{"intent": "savings_query", "confidence": "high", "reasoning": "user asked about savings"}',
    )
    expect(result).toEqual({ intent: 'savings_query', confidence: 'high' })
  })

  it('parses all valid intents without returning null', () => {
    for (const intent of INTENTS) {
      const result = parseClassificationResponse(`{"intent": "${intent}", "confidence": "high"}`)
      expect(result).not.toBeNull()
      expect(result?.intent).toBe(intent)
    }
  })
})
