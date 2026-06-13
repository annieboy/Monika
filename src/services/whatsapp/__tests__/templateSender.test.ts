import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendTemplateMessage, SendError } from '../sender.js'
import type { TemplateComponent } from '../sender.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const PHONE        = '447700900001'
const TEMPLATE     = 'monika_opportunity_v1'
const LANG         = 'en_GB'
const PHONE_ID     = 'phone-id-123'
const ACCESS_TOKEN = 'test-token'

const COMPONENTS: TemplateComponent[] = [
  {
    type: 'body',
    parameters: [
      { type: 'text', text: 'Marcus by Goldman Sachs' },
      { type: 'text', text: '£240' },
    ],
  },
  {
    type: 'button',
    sub_type: 'url',
    index: 0,
    parameters: [{ type: 'url', url: 'https://monika.app/r/abc123' }],
  },
]

function mockSuccess(wamid = 'wamid.template.1') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      messaging_product: 'whatsapp',
      contacts: [{ input: PHONE, wa_id: PHONE }],
      messages: [{ id: wamid }],
    }),
  })
}

describe('sendTemplateMessage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a template message and returns wamid', async () => {
    mockSuccess('wamid.tmpl.1')
    const result = await sendTemplateMessage(PHONE, TEMPLATE, LANG, COMPONENTS, PHONE_ID, ACCESS_TOKEN)
    expect(result.waMessageId).toBe('wamid.tmpl.1')
  })

  it('sends correct template payload to Meta API', async () => {
    mockSuccess()
    await sendTemplateMessage(PHONE, TEMPLATE, LANG, COMPONENTS, PHONE_ID, ACCESS_TOKEN)

    const [url, options] = mockFetch.mock.calls[0] as [string, { body: string; headers: Record<string, string> }]
    expect(url).toContain(`/${PHONE_ID}/messages`)

    const body = JSON.parse(options.body) as {
      type: string
      template: { name: string; language: { code: string }; components: unknown[] }
    }
    expect(body.type).toBe('template')
    expect(body.template.name).toBe(TEMPLATE)
    expect(body.template.language.code).toBe(LANG)
    expect(body.template.components).toHaveLength(2)
  })

  it('includes Authorization header', async () => {
    mockSuccess()
    await sendTemplateMessage(PHONE, TEMPLATE, LANG, COMPONENTS, PHONE_ID, ACCESS_TOKEN)

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(options.headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('throws SendError when no wamid returned', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messaging_product: 'whatsapp', contacts: [], messages: [] }),
    })
    await expect(
      sendTemplateMessage(PHONE, TEMPLATE, LANG, COMPONENTS, PHONE_ID, ACCESS_TOKEN)
    ).rejects.toThrow(SendError)
  })

  it('throws SendError on 4xx without retrying', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad template name',
    })
    await expect(
      sendTemplateMessage(PHONE, TEMPLATE, LANG, COMPONENTS, PHONE_ID, ACCESS_TOKEN)
    ).rejects.toThrow(SendError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 5xx and succeeds on second attempt', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service unavailable' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: 'wamid.retry.1' }] }),
      })

    const result = await sendTemplateMessage(PHONE, TEMPLATE, LANG, COMPONENTS, PHONE_ID, ACCESS_TOKEN)
    expect(result.waMessageId).toBe('wamid.retry.1')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
