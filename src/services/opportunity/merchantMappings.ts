/**
 * Maps raw merchant name fragments (uppercase) → normalised provider slugs.
 * Used by RecurringPaymentDetector and OpportunityDetector to identify
 * which provider a transaction belongs to so competing offers can be found.
 *
 * Rules: longest match wins. Add new entries as real transaction data reveals them.
 */

export const MERCHANT_SLUG_MAP: Record<string, string> = {
  // ── Broadband ──────────────────────────────────────────────────────────────
  'SKY BROADBAND': 'sky',
  'SKY DIGITAL': 'sky',
  'SKY TV': 'sky',
  'SKY': 'sky',
  'BT GROUP': 'bt',
  'BT BROADBAND': 'bt',
  'BT INTERNET': 'bt',
  'BRITISH TELECOM': 'bt',
  'VIRGIN MEDIA': 'virgin-media',
  'VIRGINMEDIA': 'virgin-media',
  'TALKTALK': 'talktalk',
  'TALK TALK': 'talktalk',
  'VODAFONE HOME': 'vodafone-broadband',
  'NOW BROADBAND': 'now-broadband',
  'HYPEROPTIC': 'hyperoptic',
  'COMMUNITY FIBRE': 'community-fibre',

  // ── Mobile ─────────────────────────────────────────────────────────────────
  'EE LIMITED': 'ee',
  'EE MOBILE': 'ee',
  'EE': 'ee',
  'O2 UK': 'o2',
  'O2': 'o2',
  'VODAFONE': 'vodafone',
  'THREE UK': 'three',
  'THREE': 'three',
  'GIFFGAFF': 'giffgaff',
  'SMARTY': 'smarty',
  'LEBARA': 'lebara',
  'TESCO MOBILE': 'tesco-mobile',
  'ID MOBILE': 'id-mobile',
  'SKY MOBILE': 'sky-mobile',

  // ── Streaming / Subscriptions ──────────────────────────────────────────────
  'NETFLIX': 'netflix',
  'NETFLIX.COM': 'netflix',
  'SPOTIFY': 'spotify',
  'AMAZON PRIME': 'amazon-prime',
  'AMAZON*PRIME': 'amazon-prime',
  'DISNEY PLUS': 'disney-plus',
  'DISNEY+': 'disney-plus',
  'APPLE ONE': 'apple-one',
  'APPLE.COM/BILL': 'apple',
  'YOUTUBE PREMIUM': 'youtube-premium',

  // ── Accounting software ────────────────────────────────────────────────────
  'XERO': 'xero',
  'XERO.COM': 'xero',
  'QUICKBOOKS': 'quickbooks',
  'INTUIT': 'quickbooks',
  'SAGE': 'sage',
  'SAGE GROUP': 'sage',
  'FREEAGENT': 'freeagent',
  'FREE AGENT': 'freeagent',
  'FRESHBOOKS': 'freshbooks',
  'CLEARBOOKS': 'clearbooks',
  'KASHFLOW': 'kashflow',
  'ZOHO BOOKS': 'zoho-books',

  // ── Business banking ───────────────────────────────────────────────────────
  'BARCLAYS': 'barclays',
  'HSBC': 'hsbc',
  'LLOYDS': 'lloyds',
  'NATWEST': 'natwest',
  'NATIONWIDE': 'nationwide',
  'SANTANDER': 'santander',
  'MONZO': 'monzo',
  'STARLING': 'starling',
  'TIDE PLATFORM': 'tide',
  'TIDE': 'tide',
  'REVOLUT': 'revolut',

  // ── Insurance ──────────────────────────────────────────────────────────────
  'DIRECT LINE': 'direct-line',
  'AVIVA': 'aviva',
  'ADMIRAL': 'admiral',
  'COMPARE THE MARKET': 'comparethemarket',
  'CONFUSED.COM': 'confused',
  'MONEYSUPERMARKET': 'moneysupermarket',

  // ── Utilities ──────────────────────────────────────────────────────────────
  'BRITISH GAS': 'british-gas',
  'BRITISHGAS': 'british-gas',
  'OCTOPUS ENERGY': 'octopus-energy',
  'EON': 'eon',
  'E.ON': 'eon',
  'BULB': 'bulb',
  'OVO ENERGY': 'ovo-energy',
  'THAMES WATER': 'thames-water',
  'SEVERN TRENT': 'severn-trent',
}

/**
 * Merchant category mappings — maps provider slug → transaction category slug.
 * Used to filter offers by category when no merchant slug match is found.
 */
export const PROVIDER_CATEGORY_MAP: Record<string, string> = {
  'sky': 'broadband',
  'bt': 'broadband',
  'virgin-media': 'broadband',
  'talktalk': 'broadband',
  'vodafone-broadband': 'broadband',
  'hyperoptic': 'broadband',
  'ee': 'mobile',
  'o2': 'mobile',
  'vodafone': 'mobile',
  'three': 'mobile',
  'giffgaff': 'mobile',
  'xero': 'accounting',
  'quickbooks': 'accounting',
  'sage': 'accounting',
  'freeagent': 'accounting',
  'barclays': 'banking',
  'hsbc': 'banking',
  'lloyds': 'banking',
  'monzo': 'banking',
  'tide': 'banking',
}

/**
 * Normalise a raw merchant name to a provider slug.
 * Longest match wins — so "SKY BROADBAND" matches before "SKY".
 */
export function detectProviderSlug(merchantName: string): string | null {
  const upper = merchantName.toUpperCase().trim()
  const entries = Object.entries(MERCHANT_SLUG_MAP)
    .sort((a, b) => b[0].length - a[0].length) // longest match wins

  for (const [pattern, slug] of entries) {
    // Short patterns (≤4 chars, e.g. "EE", "O2", "BT") must match as whole words
    // to avoid false-positives like "EE" inside "COFFEE"
    if (pattern.length <= 4) {
      const wordBoundary = new RegExp(`(?<![A-Z0-9])${pattern}(?![A-Z0-9])`)
      if (wordBoundary.test(upper)) return slug
    } else {
      if (upper.includes(pattern)) return slug
    }
  }
  return null
}

/**
 * Derive a URL-safe slug from a raw merchant name.
 * Used when no known provider mapping exists.
 */
export function slugifyMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
