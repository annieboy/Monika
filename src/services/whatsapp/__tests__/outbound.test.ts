import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../sender.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sender.js')>()),
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid.text' }),
  sendInteractiveButtons: vi.fn().mockResolvedValue({ waMessageId: 'wamid.buttons' }),
  sendCtaUrlMessage: vi.fn().mockResolvedValue({ waMessageId: 'wamid.cta' }),
}))

import { buildOutbound, sendOutbound } from '../outbound.js'
import { sendWhatsAppMessage, sendInteractiveButtons, sendCtaUrlMessage, SendError } from '../sender.js'

const LINK = 'https://monika.example.com/banking/start?token=' + 'ab12'.repeat(16)
const CONNECT_TEXT =
  `To connect your bank, tap this link — it expires in 15 minutes:\n${LINK}\n\n` +
  `Once connected, I'll import your last 90 days of transactions automatically.`
const BUTTONS = [{ id: 'a', title: 'My balance' }, { id: 'b', title: 'What can you do?' }]

describe('buildOutbound', () => {
  it('leaves an ordinary reply as plain text', () => {
    const out = buildOutbound('You have £1,234.00.')
    expect(out).toEqual({ text: 'You have £1,234.00.', fallbackText: 'You have £1,234.00.' })
  })

  it('turns a bank-connect link into a button and takes the raw URL out of the body', () => {
    const out = buildOutbound(CONNECT_TEXT)
    expect(out.cta).toEqual({ label: 'Connect my bank', url: LINK })
    expect(out.text).not.toContain('http')
    expect(out.text).toBe(
      `To connect your bank, tap the button below — it expires in 15 minutes.\n\n` +
        `Once connected, I'll import your last 90 days of transactions automatically.`,
    )
    // The original, link included, is kept for the plain-text fallback
    expect(out.fallbackText).toBe(CONNECT_TEXT)
  })

  it('attaches suggested reply buttons', () => {
    const out = buildOutbound('Good morning 👋', BUTTONS)
    expect(out.buttons).toEqual(BUTTONS)
    expect(out.cta).toBeUndefined()
  })

  it('prefers the connect button over reply buttons when both apply', () => {
    const out = buildOutbound(CONNECT_TEXT, BUTTONS)
    expect(out.cta).toBeDefined()
    expect(out.buttons).toBeUndefined()
  })

  it('keeps a reply too long for an interactive body as plain text', () => {
    const long = 'x'.repeat(1025)
    expect(buildOutbound(long, BUTTONS).buttons).toBeUndefined()
    expect(buildOutbound(`${long}\n${LINK}`).cta).toBeUndefined()
  })

  it('ignores more than three buttons rather than sending an invalid message', () => {
    const four = [...BUTTONS, { id: 'c', title: 'Three' }, { id: 'd', title: 'Four' }]
    expect(buildOutbound('Pick one', four).buttons).toBeUndefined()
  })
})

describe('sendOutbound', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends plain text when there is nothing interactive', async () => {
    const r = await sendOutbound('447700900001', buildOutbound('Hello'), 'pnid', 'tok')
    expect(r.waMessageId).toBe('wamid.text')
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('447700900001', 'Hello', 'pnid', 'tok')
  })

  it('sends reply buttons', async () => {
    const r = await sendOutbound('447700900001', buildOutbound('Hi 👋', BUTTONS), 'pnid', 'tok')
    expect(r.waMessageId).toBe('wamid.buttons')
    expect(sendInteractiveButtons).toHaveBeenCalledWith('447700900001', 'Hi 👋', BUTTONS, 'pnid', 'tok')
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('sends the connect link as a link button', async () => {
    const r = await sendOutbound('447700900001', buildOutbound(CONNECT_TEXT), 'pnid', 'tok')
    expect(r.waMessageId).toBe('wamid.cta')
    expect(sendCtaUrlMessage).toHaveBeenCalledWith(
      '447700900001', expect.not.stringContaining('http'), 'Connect my bank', LINK, 'pnid', 'tok',
    )
  })

  it('falls back to the original text — link included — if the link button is rejected', async () => {
    vi.mocked(sendCtaUrlMessage).mockRejectedValueOnce(new SendError('rejected', 400))
    const r = await sendOutbound('447700900001', buildOutbound(CONNECT_TEXT), 'pnid', 'tok')
    expect(r.waMessageId).toBe('wamid.text')
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('447700900001', CONNECT_TEXT, 'pnid', 'tok')
  })

  it('does not swallow unexpected (non-send) errors', async () => {
    vi.mocked(sendInteractiveButtons).mockRejectedValueOnce(new TypeError('boom'))
    await expect(sendOutbound('447700900001', buildOutbound('Hi', BUTTONS), 'pnid', 'tok')).rejects.toThrow('boom')
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})
