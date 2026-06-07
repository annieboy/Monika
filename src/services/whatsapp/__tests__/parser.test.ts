import { describe, it, expect } from 'vitest'
import { parseTextMessage, parseStatusUpdates } from '../parser.js'
import type { WhatsAppWebhookPayload } from '../../../types/whatsapp.js'

function makeTextPayload(): WhatsAppWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '447700900000', phone_number_id: 'waba-123' },
              messages: [
                {
                  id: 'wamid.text1',
                  from: '447700900001',
                  timestamp: '1717776000',
                  type: 'text',
                  text: { body: 'Hello' },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function makeStatusPayload(statuses: unknown[]): WhatsAppWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '447700900000', phone_number_id: 'waba-123' },
              statuses: statuses,
            },
          },
        ],
      },
    ],
  }
}

describe('parseTextMessage', () => {
  it('extracts text message fields', () => {
    const result = parseTextMessage(makeTextPayload())
    expect(result).toMatchObject({
      waMessageId: 'wamid.text1',
      from: '447700900001',
      text: 'Hello',
    })
    expect(result?.timestamp).toBeInstanceOf(Date)
  })

  it('returns null for status-only payload', () => {
    const payload = makeStatusPayload([
      { id: 'wamid.out1', status: 'delivered', timestamp: '1717776100', recipient_id: '447' },
    ])
    expect(parseTextMessage(payload)).toBeNull()
  })

  it('returns null for image message', () => {
    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'e1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '447700900000', phone_number_id: 'waba-123' },
                messages: [{ id: 'img1', from: '447', timestamp: '123', type: 'image' }],
              },
            },
          ],
        },
      ],
    }
    expect(parseTextMessage(payload)).toBeNull()
  })
})

describe('parseStatusUpdates', () => {
  it('parses a delivered status update', () => {
    const payload = makeStatusPayload([
      { id: 'wamid.out1', status: 'delivered', timestamp: '1717776100', recipient_id: '447700900001' },
    ])
    const results = parseStatusUpdates(payload)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      waMessageId: 'wamid.out1',
      status: 'delivered',
      recipientPhone: '447700900001',
    })
    expect(results[0]?.timestamp).toBeInstanceOf(Date)
  })

  it('parses a failed status update with error details', () => {
    const payload = makeStatusPayload([
      {
        id: 'wamid.out2',
        status: 'failed',
        timestamp: '1717776200',
        recipient_id: '447700900001',
        errors: [{ code: 131026, title: 'Message Undeliverable' }],
      },
    ])
    const results = parseStatusUpdates(payload)
    expect(results[0]).toMatchObject({
      status: 'failed',
      errorCode: 131026,
      errorTitle: 'Message Undeliverable',
    })
  })

  it('parses multiple status updates from one payload', () => {
    const payload = makeStatusPayload([
      { id: 'wamid.a', status: 'sent', timestamp: '1717776000', recipient_id: '447' },
      { id: 'wamid.b', status: 'delivered', timestamp: '1717776050', recipient_id: '447' },
    ])
    expect(parseStatusUpdates(payload)).toHaveLength(2)
  })

  it('returns empty array for text-only payload', () => {
    expect(parseStatusUpdates(makeTextPayload())).toHaveLength(0)
  })

  it('skips malformed status entries', () => {
    const payload = makeStatusPayload([
      { id: 'wamid.ok', status: 'read', timestamp: '123', recipient_id: '447' },
      { bad: 'entry' },
      null,
    ])
    const results = parseStatusUpdates(payload)
    expect(results).toHaveLength(1)
  })
})
