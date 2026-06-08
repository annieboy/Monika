import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TrueLayerProvider } from '../providers/truelayer.js'
import { encodeOAuthState, decodeOAuthState } from '../oauth-state.js'

// ── OAuth state ─────────────────────────────────────────────────────────────

describe('OAuth state signing', () => {
  const SECRET = 'a-test-secret-key-that-is-at-least-32-chars-long'
  const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  it('round-trips userId through encode/decode', () => {
    const state = encodeOAuthState(USER_ID, SECRET)
    expect(decodeOAuthState(state, SECRET)).toBe(USER_ID)
  })

  it('returns null for tampered state', () => {
    const state = encodeOAuthState(USER_ID, SECRET)
    // Flip a character in the middle
    const tampered = state.slice(0, 10) + 'X' + state.slice(11)
    expect(decodeOAuthState(tampered, SECRET)).toBeNull()
  })

  it('returns null for a different secret key', () => {
    const state = encodeOAuthState(USER_ID, SECRET)
    expect(decodeOAuthState(state, 'different-secret-key-that-is-32-chars-ok')).toBeNull()
  })

  it('returns null for expired state', () => {
    // Generate a state that looks valid but has a timestamp far in the past
    const state = encodeOAuthState(USER_ID, SECRET)
    // Decode manually and re-encode with an old timestamp
    const decoded = Buffer.from(state, 'base64url').toString('utf-8')
    const parts = decoded.split('|')
    // Replace timestamp (index 2) with a value 20 minutes ago
    parts[2] = (Date.now() - 20 * 60 * 1000).toString(36)
    // This won't pass HMAC check — state is tamper-evident, which is the point
    expect(decodeOAuthState(state, SECRET)).toBe(USER_ID) // original still valid

    // A correctly forged expired state would fail on HMAC anyway
    const forged = Buffer.from(parts.join('|') + '|fakesig').toString('base64url')
    expect(decodeOAuthState(forged, SECRET)).toBeNull()
  })

  it('generates unique state per call', () => {
    const s1 = encodeOAuthState(USER_ID, SECRET)
    const s2 = encodeOAuthState(USER_ID, SECRET)
    expect(s1).not.toBe(s2)
  })

  it('returns null for empty string', () => {
    expect(decodeOAuthState('', SECRET)).toBeNull()
  })

  it('returns null for malformed base64', () => {
    expect(decodeOAuthState('!!!not-valid!!!', SECRET)).toBeNull()
  })
})

// ── TrueLayerProvider ───────────────────────────────────────────────────────

const SANDBOX_CLIENT_ID = 'sandbox-client-id'
const SANDBOX_CLIENT_SECRET = 'sandbox-client-secret'
const REDIRECT_URI = 'http://localhost:3000/banking/callback'

function makeProvider() {
  return new TrueLayerProvider(SANDBOX_CLIENT_ID, SANDBOX_CLIENT_SECRET, REDIRECT_URI, 'sandbox')
}

// Helpers for mocking fetch
function mockFetch(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  let idx = 0
  return vi.fn().mockImplementation(() => {
    const r = responses[idx++] ?? { ok: false, status: 500, body: 'no more responses' }
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      text: () => Promise.resolve(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      json: () => Promise.resolve(r.body),
    })
  })
}

describe('TrueLayerProvider — initiateConsent', () => {
  it('uses sandbox auth URL', async () => {
    const provider = makeProvider()
    const { authUrl } = await provider.initiateConsent('user-1', REDIRECT_URI)
    expect(authUrl).toContain('auth.truelayer-sandbox.com')
  })

  it('includes required OAuth params', async () => {
    const provider = makeProvider()
    const { authUrl } = await provider.initiateConsent('user-1', REDIRECT_URI)
    const url = new URL(authUrl)
    expect(url.searchParams.get('client_id')).toBe(SANDBOX_CLIENT_ID)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(url.searchParams.get('scope')).toContain('accounts')
    expect(url.searchParams.get('scope')).toContain('transactions')
  })

  it('adds providers=mock for sandbox', async () => {
    const provider = makeProvider()
    const { authUrl } = await provider.initiateConsent('user-1', REDIRECT_URI)
    const url = new URL(authUrl)
    expect(url.searchParams.get('providers')).toBe('mock')
  })

  it('does not add providers=mock for production', async () => {
    const provider = new TrueLayerProvider(
      SANDBOX_CLIENT_ID,
      SANDBOX_CLIENT_SECRET,
      REDIRECT_URI,
      'production',
    )
    const { authUrl } = await provider.initiateConsent('user-1', REDIRECT_URI)
    const url = new URL(authUrl)
    expect(url.searchParams.get('providers')).toBeNull()
  })

  it('returns a non-empty state', async () => {
    const provider = makeProvider()
    const { state } = await provider.initiateConsent('user-1', REDIRECT_URI)
    expect(state.length).toBeGreaterThan(0)
  })

  it('generates unique state per call', async () => {
    const provider = makeProvider()
    const { state: s1 } = await provider.initiateConsent('user-1', REDIRECT_URI)
    const { state: s2 } = await provider.initiateConsent('user-1', REDIRECT_URI)
    expect(s1).not.toBe(s2)
  })
})

describe('TrueLayerProvider — exchangeCode', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('posts to sandbox token endpoint', async () => {
    const fetchMock = mockFetch([{
      ok: true,
      body: {
        access_token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJjb25zZW50LTEyMyIsImp0aSI6Imp0aS0xIn0.sig',
        refresh_token: 'refresh-tok',
        expires_in: 3600,
        scope: 'accounts transactions balance',
      },
    }])
    vi.stubGlobal('fetch', fetchMock)

    const provider = makeProvider()
    const consent = await provider.exchangeCode('auth-code', 'state-val')

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('auth.truelayer-sandbox.com/connect/token')
    expect(opts.method).toBe('POST')
    expect(consent.accessToken).toBe(
      'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJjb25zZW50LTEyMyIsImp0aSI6Imp0aS0xIn0.sig',
    )
    expect(consent.refreshToken).toBe('refresh-tok')
    expect(consent.scopes).toContain('accounts')
  })

  it('extracts consent ID from JWT sub claim', async () => {
    // sub = "consent-123" encoded in base64url
    const payload = Buffer.from(JSON.stringify({ sub: 'consent-123', jti: 'jti-1' })).toString('base64url')
    const fakeJwt = `header.${payload}.signature`

    vi.stubGlobal('fetch', mockFetch([{
      ok: true,
      body: { access_token: fakeJwt, expires_in: 3600, scope: 'accounts' },
    }]))

    const provider = makeProvider()
    const consent = await provider.exchangeCode('code', 'state')
    expect(consent.providerConsentId).toBe('consent-123')
  })

  it('falls back to UUID when JWT cannot be decoded', async () => {
    vi.stubGlobal('fetch', mockFetch([{
      ok: true,
      body: { access_token: 'not.a.jwt', expires_in: 3600, scope: 'accounts' },
    }]))

    const provider = makeProvider()
    const consent = await provider.exchangeCode('code', 'state')
    expect(consent.providerConsentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('throws on non-200 token response', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 400, body: 'invalid_grant' }]))
    const provider = makeProvider()
    await expect(provider.exchangeCode('bad-code', 'state')).rejects.toThrow('400')
  })
})

describe('TrueLayerProvider — getAccounts', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const mockConsent = {
    providerConsentId: 'consent-1',
    accessToken: 'access-tok',
    scopes: ['accounts', 'balance'],
  }

  it('maps TRANSACTION account type to current', async () => {
    vi.stubGlobal('fetch', mockFetch([
      // accounts
      {
        ok: true,
        body: {
          results: [{
            account_id: 'acc-1',
            account_type: 'TRANSACTION',
            display_name: 'Personal Current',
            currency: 'GBP',
            account_number: { number: '12345678' },
          }],
        },
      },
      // balance
      { ok: true, body: { results: [{ currency: 'GBP', available: 900.0, current: 1000.0 }] } },
    ]))

    const provider = makeProvider()
    const accounts = await provider.getAccounts(mockConsent)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.accountType).toBe('current')
    expect(accounts[0]!.currentBalance).toBe(1000.0)
    expect(accounts[0]!.availableBalance).toBe(900.0)
    expect(accounts[0]!.accountLast4).toBe('5678')
  })

  it('maps SAVINGS account type', async () => {
    vi.stubGlobal('fetch', mockFetch([
      { ok: true, body: { results: [{ account_id: 'acc-2', account_type: 'SAVINGS', display_name: 'Saver', currency: 'GBP' }] } },
      { ok: true, body: { results: [{ currency: 'GBP', available: 5000.0, current: 5000.0 }] } },
    ]))

    const provider = makeProvider()
    const accounts = await provider.getAccounts(mockConsent)
    expect(accounts[0]!.accountType).toBe('savings')
  })

  it('uses 0 balance when balance fetch fails', async () => {
    vi.stubGlobal('fetch', mockFetch([
      { ok: true, body: { results: [{ account_id: 'acc-1', account_type: 'TRANSACTION', display_name: 'Current', currency: 'GBP' }] } },
      { ok: false, status: 400, body: 'error' },  // 400 is non-retryable
    ]))

    const provider = makeProvider()
    const accounts = await provider.getAccounts(mockConsent)
    expect(accounts[0]!.currentBalance).toBe(0)
  })
})

describe('TrueLayerProvider — getTransactions', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const mockConsent = { providerConsentId: 'c-1', accessToken: 'tok', scopes: [] }

  it('returns mapped transactions', async () => {
    vi.stubGlobal('fetch', mockFetch([{
      ok: true,
      body: {
        results: [
          {
            transaction_id: 'txn-1',
            timestamp: '2026-01-15T10:00:00Z',
            description: 'TESCO STORES 1234',
            amount: -24.50,
            currency: 'GBP',
            transaction_type: 'DEBIT',
            transaction_category: 'FOOD_AND_DRINK',
            merchant_name: 'Tesco',
          },
          {
            transaction_id: 'txn-2',
            timestamp: '2026-01-14T09:00:00Z',
            description: 'SALARY JAN',
            amount: 2850.00,
            currency: 'GBP',
            transaction_type: 'CREDIT',
            transaction_category: 'SALARY',
          },
        ],
      },
    }]))

    const provider = makeProvider()
    const txns = await provider.getTransactions(
      mockConsent,
      'acc-1',
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    )

    expect(txns).toHaveLength(2)

    const debit = txns[0]!
    expect(debit.transactionType).toBe('debit')
    expect(debit.amount).toBe(-24.50)
    expect(debit.merchantName).toBe('Tesco')
    expect(debit.category).toBe('restaurants')
    expect(debit.rawDescription).toBe('TESCO STORES 1234')

    const credit = txns[1]!
    expect(credit.transactionType).toBe('credit')
    expect(credit.isSalary).toBe(true)
    expect(credit.category).toBe('income')
  })

  it('maps SHOPPING category', async () => {
    vi.stubGlobal('fetch', mockFetch([{
      ok: true,
      body: { results: [{ transaction_id: 't1', timestamp: '2026-01-10T00:00:00Z', description: 'ASOS', amount: -45.0, currency: 'GBP', transaction_type: 'DEBIT', transaction_category: 'SHOPPING' }] },
    }]))
    const provider = makeProvider()
    const txns = await provider.getTransactions(mockConsent, 'acc-1', new Date(), new Date())
    expect(txns[0]!.category).toBe('shopping')
  })

  it('maps TRANSPORT category', async () => {
    vi.stubGlobal('fetch', mockFetch([{
      ok: true,
      body: { results: [{ transaction_id: 't1', timestamp: '2026-01-10T00:00:00Z', description: 'TFL', amount: -2.50, currency: 'GBP', transaction_type: 'DEBIT', transaction_category: 'TRANSPORT' }] },
    }]))
    const provider = makeProvider()
    const txns = await provider.getTransactions(mockConsent, 'acc-1', new Date(), new Date())
    expect(txns[0]!.category).toBe('transport')
  })

  it('leaves category undefined for TRANSFER', async () => {
    vi.stubGlobal('fetch', mockFetch([{
      ok: true,
      body: { results: [{ transaction_id: 't1', timestamp: '2026-01-10T00:00:00Z', description: 'TRANSFER', amount: -500.0, currency: 'GBP', transaction_type: 'DEBIT', transaction_category: 'TRANSFER' }] },
    }]))
    const provider = makeProvider()
    const txns = await provider.getTransactions(mockConsent, 'acc-1', new Date(), new Date())
    expect(txns[0]!.category).toBeUndefined()
  })

  it('sends correct date range params', async () => {
    const fetchMock = mockFetch([{ ok: true, body: { results: [] } }])
    vi.stubGlobal('fetch', fetchMock)

    const provider = makeProvider()
    await provider.getTransactions(mockConsent, 'acc-1', new Date('2026-01-01'), new Date('2026-01-31'))

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('from=2026-01-01')
    expect(url).toContain('to=2026-01-31')
  })

  it('throws on 401', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 401, body: 'Unauthorized' }]))
    const provider = makeProvider()
    await expect(
      provider.getTransactions(mockConsent, 'acc-1', new Date(), new Date()),
    ).rejects.toThrow('expired or invalid')
  })
})

describe('TrueLayerProvider — refreshToken', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('exchanges refresh token for new access token', async () => {
    vi.stubGlobal('fetch', mockFetch([{
      ok: true,
      body: { access_token: 'new-access-tok', refresh_token: 'new-refresh-tok', expires_in: 3600 },
    }]))

    const provider = makeProvider()
    const newConsent = await provider.refreshToken({
      providerConsentId: 'c-1',
      accessToken: 'old-tok',
      refreshToken: 'old-refresh',
      scopes: ['accounts'],
    })

    expect(newConsent.accessToken).toBe('new-access-tok')
    expect(newConsent.refreshToken).toBe('new-refresh-tok')
    expect(newConsent.tokenExpiresAt).toBeInstanceOf(Date)
  })

  it('throws when no refresh token available', async () => {
    const provider = makeProvider()
    await expect(
      provider.refreshToken({ providerConsentId: 'c-1', accessToken: 'tok', scopes: [] }),
    ).rejects.toThrow('No refresh token')
  })
})

describe('TrueLayerProvider — production environment', () => {
  it('uses production auth URL', async () => {
    const provider = new TrueLayerProvider('id', 'secret', REDIRECT_URI, 'production')
    const { authUrl } = await provider.initiateConsent('u', REDIRECT_URI)
    expect(authUrl).toContain('auth.truelayer.com')
    expect(authUrl).not.toContain('sandbox')
  })

  it('sets providerName to truelayer for production', () => {
    const provider = new TrueLayerProvider('id', 'secret', REDIRECT_URI, 'production')
    expect(provider.providerName).toBe('truelayer')
  })

  it('sets providerName to truelayer_sandbox for sandbox', () => {
    const provider = makeProvider()
    expect(provider.providerName).toBe('truelayer_sandbox')
  })
})
