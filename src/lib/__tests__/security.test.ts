import { describe, it, expect, vi } from 'vitest'
import { isPayloadTooLarge, validateWebhookContentType, MAX_WEBHOOK_PAYLOAD_BYTES } from '../security.js'

describe('isPayloadTooLarge', () => {
  it('returns false for undefined', () => {
    expect(isPayloadTooLarge(undefined)).toBe(false)
  })

  it('returns false for payload within limit', () => {
    const small = Buffer.alloc(1000)
    expect(isPayloadTooLarge(small)).toBe(false)
  })

  it('returns true for payload exactly at limit + 1', () => {
    const big = Buffer.alloc(MAX_WEBHOOK_PAYLOAD_BYTES + 1)
    expect(isPayloadTooLarge(big)).toBe(true)
  })

  it('returns false for payload exactly at limit', () => {
    const exact = Buffer.alloc(MAX_WEBHOOK_PAYLOAD_BYTES)
    expect(isPayloadTooLarge(exact)).toBe(false)
  })

  it('handles string payloads', () => {
    const tiny = 'hello'
    expect(isPayloadTooLarge(tiny)).toBe(false)
  })
})

describe('validateWebhookContentType', () => {
  function makeReply() {
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      removeHeader: vi.fn(),
      header: vi.fn(),
    }
    return reply
  }

  it('returns true for non-POST requests', () => {
    const request = { method: 'GET', headers: {} } as unknown as import('fastify').FastifyRequest
    const reply = makeReply()
    expect(validateWebhookContentType(request, reply as never)).toBe(true)
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('returns true for POST with application/json', () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
    } as unknown as import('fastify').FastifyRequest
    const reply = makeReply()
    expect(validateWebhookContentType(request, reply as never)).toBe(true)
  })

  it('returns false and sends 415 for POST without JSON content-type', () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    } as unknown as import('fastify').FastifyRequest
    const reply = makeReply()
    const result = validateWebhookContentType(request, reply as never)
    expect(result).toBe(false)
    expect(reply.status).toHaveBeenCalledWith(415)
    expect(reply.send).toHaveBeenCalledWith({ error: expect.stringContaining('Content-Type') })
  })

  it('returns false for POST with missing content-type', () => {
    const request = {
      method: 'POST',
      headers: {},
    } as unknown as import('fastify').FastifyRequest
    const reply = makeReply()
    expect(validateWebhookContentType(request, reply as never)).toBe(false)
  })
})
