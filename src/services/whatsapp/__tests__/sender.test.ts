import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendWhatsAppMessage, SendError } from '../sender.js'

const PHONE_NUMBER_ID = 'pnid-123'
const ACCESS_TOKEN = 'token-abc'
const TO = '447700900001'
const TEXT = 'Hello from Monika'

function makeSuccessResponse(wamid = 'wamid.abc123') {
  return {
    messaging_product: 'whatsapp',
    contacts: [{ input: TO, wa_id: TO }],
    messages: [{ id: wamid }],
  }
}

function mockFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  let call = 0
  return vi.fn(async () => {
    const res = responses[call] ?? responses.at(-1)!
    call++
    const bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
    return {
      ok: res.ok,
      status: res.status,
      json: async () => JSON.parse(bodyStr) as unknown,
      text: async () => bodyStr,
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendWhatsAppMessage', () => {
  it('returns waMessageId on success', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: true, status: 200, body: makeSuccessResponse('wamid.xyz') }]))

    const result = await sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)

    expect(result.waMessageId).toBe('wamid.xyz')
  })

  it('sends to the correct Meta Graph API URL', async () => {
    const fetchMock = mockFetch([{ ok: true, status: 200, body: makeSuccessResponse() }])
    vi.stubGlobal('fetch', fetchMock)

    await sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`)
    expect(opts.method).toBe('POST')
    expect(opts.headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
  })

  it('sends a correctly structured JSON body', async () => {
    const fetchMock = mockFetch([{ ok: true, status: 200, body: makeSuccessResponse() }])
    vi.stubGlobal('fetch', fetchMock)

    await sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)

    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(opts.body as string) as unknown
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: TO,
      type: 'text',
      text: { preview_url: false, body: TEXT },
    })
  })

  it('retries on 5xx and succeeds on second attempt', async () => {
    const fetchMock = mockFetch([
      { ok: false, status: 500, body: 'Internal Server Error' },
      { ok: true, status: 200, body: makeSuccessResponse('wamid.retry') },
    ])
    vi.stubGlobal('fetch', mockFetch([
      { ok: false, status: 500, body: 'Internal Server Error' },
      { ok: true, status: 200, body: makeSuccessResponse('wamid.retry') },
    ]))
    // Re-stub to avoid timing in the real test
    const fn = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 500,
        text: async () => 'error',
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => JSON.stringify(makeSuccessResponse('wamid.retry')),
        json: async () => makeSuccessResponse('wamid.retry'),
      })
    vi.stubGlobal('fetch', fn)

    const result = await sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)

    expect(result.waMessageId).toBe('wamid.retry')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws SendError with status code on non-retryable 4xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Unauthorized"}',
    }))

    await expect(sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)).rejects.toMatchObject({
      name: 'SendError',
      statusCode: 401,
    })
  })

  it('throws SendError after all retries exhausted on persistent 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    }))

    await expect(sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)).rejects.toMatchObject({
      name: 'SendError',
    })
  })

  it('retries on network error and succeeds', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('ECONNREFUSED')
      return {
        ok: true, status: 200,
        json: async () => makeSuccessResponse('wamid.net'),
      }
    }))

    const result = await sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)
    expect(result.waMessageId).toBe('wamid.net')
    expect(calls).toBe(2)
  })

  it('throws SendError if response has no message id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messaging_product: 'whatsapp', contacts: [], messages: [] }),
    }))

    await expect(sendWhatsAppMessage(TO, TEXT, PHONE_NUMBER_ID, ACCESS_TOKEN)).rejects.toMatchObject({
      name: 'SendError',
    })
  })
})
