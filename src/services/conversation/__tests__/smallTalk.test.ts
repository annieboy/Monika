import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../../lib/crypto.js', () => ({
  decrypt: (buf: Buffer) => buf, // identity: the "encrypted" name is the name
}))

import { handleSmallTalk, isGreeting, isThanks } from '../smallTalk.js'
import { classifyIntent } from '../../agent/classifier.js'

function makePrisma(opts: { name?: string | null; connected?: boolean } = {}): PrismaClient {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({ fullNameEnc: opts.name ? Buffer.from(opts.name) : null }),
    },
    bankConnection: {
      findFirst: vi.fn().mockResolvedValue(opts.connected ? { id: 'conn-1' } : null),
    },
  } as unknown as PrismaClient
}

// 09:30 UTC on a winter day = 09:30 in London
const MORNING = new Date('2026-11-16T09:30:00Z')
const AFTERNOON = new Date('2026-11-16T14:00:00Z')
const EVENING = new Date('2026-11-16T20:15:00Z')

describe('isGreeting / isThanks', () => {
  it('recognises bare greetings', () => {
    for (const t of ['hi', 'Hi', 'hey', 'Hello', 'hello!', 'Hello Monika', 'hey there', 'good morning', 'Morning', 'hiya', 'heyyy']) {
      expect(isGreeting(t), t).toBe(true)
    }
  })

  it('does not swallow a greeting that carries a question', () => {
    for (const t of ['hi, what is my balance?', 'hello how much did I spend', 'history of payments', 'hint', 'yo-yo spending']) {
      expect(isGreeting(t), t).toBe(false)
    }
  })

  it('recognises bare thank-yous only', () => {
    for (const t of ['thanks', 'Thank you', 'thanks a lot', 'thank you so much!', 'cheers', 'thx', 'Thanks Monika']) {
      expect(isThanks(t), t).toBe(true)
    }
    for (const t of ['thanks, and my balance?', 'ok', 'yes', 'no thanks']) {
      expect(isThanks(t), t).toBe(false)
    }
  })
})

describe('handleSmallTalk', () => {
  it('returns null for anything that is not small talk (no DB lookups)', async () => {
    const prisma = makePrisma()
    expect(await handleSmallTalk(prisma, 'u1', 'what is my balance?')).toBeNull()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('greets a connected user by name with money shortcuts', async () => {
    const r = await handleSmallTalk(makePrisma({ name: 'Arnex', connected: true }), 'u1', 'Hi', MORNING)
    expect(r?.intent).toBe('greeting')
    expect(r?.response).toContain('Good morning, Arnex 👋')
    expect(r?.buttons?.map((b) => b.title)).toEqual(['My balance', 'Spending this month', 'What can you do?'])
  })

  it('offers to connect the bank when it is not connected yet', async () => {
    const r = await handleSmallTalk(makePrisma({ name: 'Arnex', connected: false }), 'u1', 'hello', AFTERNOON)
    expect(r?.response).toContain('Good afternoon, Arnex 👋')
    expect(r?.response).toContain('read-only')
    expect(r?.buttons?.map((b) => b.title)).toEqual(['Connect my bank', 'What can you do?'])
  })

  it('still greets warmly when no name is stored', async () => {
    const r = await handleSmallTalk(makePrisma({ name: null, connected: true }), 'u1', 'hey', EVENING)
    expect(r?.response).toContain('Good evening 👋')
    expect(r?.response).not.toContain('null')
  })

  it('answers a thank-you briefly, without buttons', async () => {
    const r = await handleSmallTalk(makePrisma({ name: 'Arnex' }), 'u1', 'thanks!')
    expect(r?.intent).toBe('thanks')
    expect(r?.response).toBe("You're welcome, Arnex! Anything else you'd like to check?")
    expect(r).not.toHaveProperty('buttons')
  })
})

describe('shortcut button labels', () => {
  // A tap arrives as the button's label, so each label has to work as a message.
  it('fit WhatsApp\'s 20-character button limit', async () => {
    for (const connected of [true, false]) {
      const r = await handleSmallTalk(makePrisma({ connected }), 'u1', 'hi', MORNING)
      for (const b of r!.buttons!) expect(b.title.length, b.title).toBeLessThanOrEqual(20)
    }
  })

  it('each route to the right handler when tapped', async () => {
    expect((await classifyIntent('My balance', '')).intent).toBe('account_balance')
    expect((await classifyIntent('Spending this month', '')).intent).toBe('spending_analysis')
    expect((await classifyIntent('What can you do?', '')).intent).toBe('onboarding_help')
    expect((await classifyIntent('Connect my bank', '')).intent).toBe('onboarding_help')
  })
})
