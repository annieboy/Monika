import { describe, it, expect } from 'vitest'
import {
  validateAndFormatResponse,
  FCA_DISCLAIMER,
} from '../responseValidator'

describe('validateAndFormatResponse', () => {
  // -------------------------------------------------------------------------
  // Hallucination guard
  // -------------------------------------------------------------------------

  describe('number hallucination guard', () => {
    it('passes through numbers that appear in dataContext', () => {
      const result = validateAndFormatResponse(
        'Your balance is £1,234.56 and you have 100 points.',
        { dataContext: 'balance: 1234.56, points: 100' },
      )
      expect(result.text).toContain('£1,234.56')
      expect(result.text).toContain('100')
      expect(result.warnings).toHaveLength(0)
    })

    it('flags numbers NOT in dataContext with a warning and replaces them', () => {
      const result = validateAndFormatResponse(
        'Your mortgage estimate is £250,000.',
        { dataContext: 'income: 50000' },
      )
      expect(result.text).not.toContain('250')
      expect(result.text).toContain('[unverified figure]')
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toMatch(/Hallucination guard/)
    })

    it('skips hallucination check when dataContext is undefined', () => {
      const result = validateAndFormatResponse('The answer is 42.')
      expect(result.text).toContain('42')
      expect(result.warnings).toHaveLength(0)
    })

    it('skips hallucination check when dataContext is empty string', () => {
      const result = validateAndFormatResponse('The answer is 42.', {
        dataContext: '',
      })
      expect(result.text).toContain('42')
      expect(result.warnings).toHaveLength(0)
    })

    it('handles £ currency format correctly', () => {
      const result = validateAndFormatResponse('Total: £1,234.56', {
        dataContext: 'total=1234.56',
      })
      expect(result.text).toContain('£1,234.56')
      expect(result.warnings).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // FCA disclaimer injection
  // -------------------------------------------------------------------------

  describe('FCA disclaimer injection', () => {
    it('appends FCA disclaimer when affordability_question is in toolsUsed', () => {
      const result = validateAndFormatResponse(
        'You can afford up to £200,000.',
        { toolsUsed: ['affordability_question'], dataContext: '200000' },
      )
      expect(result.text).toContain(FCA_DISCLAIMER)
    })

    it('appends FCA disclaimer when safe_to_spend is in toolsUsed', () => {
      const result = validateAndFormatResponse('You can spend £500 safely.', {
        toolsUsed: ['safe_to_spend'],
        dataContext: '500',
      })
      expect(result.text).toContain(FCA_DISCLAIMER)
    })

    it('does NOT double the FCA disclaimer when already present', () => {
      const textWithDisclaimer = `Some answer.\n\n${FCA_DISCLAIMER}`
      const result = validateAndFormatResponse(textWithDisclaimer, {
        toolsUsed: ['affordability_question'],
      })
      const occurrences = result.text.split(FCA_DISCLAIMER).length - 1
      expect(occurrences).toBe(1)
    })

    it('does NOT inject disclaimer when no relevant tools used', () => {
      const result = validateAndFormatResponse('Just a normal message.', {
        toolsUsed: ['balance_query'],
      })
      expect(result.text).not.toContain(FCA_DISCLAIMER)
    })

    it('does NOT inject disclaimer when toolsUsed is empty', () => {
      const result = validateAndFormatResponse('Just a normal message.')
      expect(result.text).not.toContain(FCA_DISCLAIMER)
    })
  })

  // -------------------------------------------------------------------------
  // Sensitive data redaction
  // -------------------------------------------------------------------------

  describe('sensitive data redaction', () => {
    it('redacts UK sort code with hyphens', () => {
      const result = validateAndFormatResponse('Sort code: 12-34-56')
      expect(result.text).not.toContain('12-34-56')
      expect(result.text).toContain('[REDACTED]')
      expect(result.warnings.some((w) => w.includes('sort code'))).toBe(true)
    })

    it('redacts 8-digit account number', () => {
      const result = validateAndFormatResponse('Account: 87654321')
      expect(result.text).not.toContain('87654321')
      expect(result.text).toContain('[REDACTED]')
      expect(result.warnings.some((w) => w.includes('account number'))).toBe(
        true,
      )
    })

    it('redacts card numbers (16 digits)', () => {
      const result = validateAndFormatResponse('Card: 4111111111111111')
      expect(result.text).not.toContain('4111111111111111')
      expect(result.text).toContain('[REDACTED]')
      expect(result.warnings.some((w) => w.includes('card number'))).toBe(true)
    })

    it('redacts full IBAN', () => {
      const result = validateAndFormatResponse('IBAN: GB29NWBK60161331926819')
      expect(result.text).not.toContain('GB29NWBK60161331926819')
      expect(result.text).toContain('[REDACTED]')
      expect(result.warnings.some((w) => w.includes('IBAN'))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // WhatsApp formatter
  // -------------------------------------------------------------------------

  describe('WhatsApp formatter', () => {
    it('converts **bold** markdown to *bold*', () => {
      const result = validateAndFormatResponse('Hello **world** today.')
      expect(result.text).toContain('*world*')
      expect(result.text).not.toContain('**world**')
    })

    it('converts # Header to *Header*', () => {
      const result = validateAndFormatResponse('# My Heading\nSome text.')
      expect(result.text).toContain('*My Heading*')
      expect(result.text).not.toContain('# My Heading')
    })

    it('converts --- separator to blank line', () => {
      const result = validateAndFormatResponse('Above\n---\nBelow')
      expect(result.text).not.toContain('---')
    })

    it('collapses more than 2 consecutive newlines', () => {
      const result = validateAndFormatResponse('A\n\n\n\nB')
      expect(result.text).not.toMatch(/\n{3,}/)
    })

    it('truncates text over 4096 characters', () => {
      const longText = 'a'.repeat(5000)
      const result = validateAndFormatResponse(longText)
      expect(result.text.length).toBeLessThanOrEqual(4096)
      expect(result.text).toContain('[Message truncated]')
    })

    it('does not truncate text within the 4096 character limit', () => {
      const shortText = 'Hello world!'
      const result = validateAndFormatResponse(shortText)
      expect(result.text).not.toContain('[Message truncated]')
      expect(result.text).toContain('Hello world!')
    })
  })
})
