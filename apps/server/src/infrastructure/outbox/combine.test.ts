import { describe, expect, it, vi } from 'vitest'

import { combineConsumers } from './combine.ts'
import type { OutboxConsumer } from './consumer.ts'

function consumer(overrides: Partial<OutboxConsumer> & { eventType: string }): OutboxConsumer {
  return { handle: async () => {}, ...overrides }
}

describe('combineConsumers', () => {
  it('runs every consumer, in order', async () => {
    const order: string[] = []
    const combined = combineConsumers(
      'Thing',
      consumer({ eventType: 'Thing', handle: async () => void order.push('first') }),
      consumer({ eventType: 'Thing', handle: async () => void order.push('second') }),
    )

    await combined.handle({})

    expect(combined.eventType).toBe('Thing')
    expect(order).toEqual(['first', 'second'])
  })

  it('stops at the first failure, so the event is retried whole', async () => {
    const second = vi.fn<() => Promise<void>>()
    const combined = combineConsumers(
      'Thing',
      consumer({
        eventType: 'Thing',
        handle: async () => {
          throw new Error('no')
        },
      }),
      consumer({ eventType: 'Thing', handle: second }),
    )

    await expect(combined.handle({})).rejects.toThrow('no')
    expect(second).not.toHaveBeenCalled()
  })

  it('applies every redaction, leaving the payload alone where a consumer has none', async () => {
    const combined = combineConsumers(
      'Thing',
      consumer({ eventType: 'Thing' }),
      consumer({
        eventType: 'Thing',
        redactPayload: (payload) => ({ ...(payload as object), token: '[redacted]' }),
      }),
    )

    expect(combined.redactPayload?.({ to: 'ada@example.com', token: 'secret' })).toEqual({
      to: 'ada@example.com',
      token: '[redacted]',
    })
  })

  it('refuses a consumer for a different event type', () => {
    expect(() => combineConsumers('Thing', consumer({ eventType: 'SomethingElse' }))).toThrow(
      'combineConsumers(Thing) was given a consumer for SomethingElse',
    )
  })
})
