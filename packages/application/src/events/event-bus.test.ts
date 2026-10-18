import { describe, expect, it, vi } from 'vitest'

import { defineEvent } from './define-event.ts'
import { createEventBus } from './event-bus.ts'
import type { RecordedEvent } from '../ports/events.ts'

interface Ping {
  readonly version: number
  readonly n: number
}

const read = (payload: unknown): Ping | null => {
  const n = (payload as { n?: unknown }).n
  return typeof n === 'number' ? { version: 1, n } : null
}
const ping = defineEvent<Ping>('Ping', { 1: read })
const pong = defineEvent<Ping>('Pong', { 1: read })

const aBus = () => {
  const onError = vi.fn<(error: unknown, event: RecordedEvent) => void>()
  return { bus: createEventBus({ onError }), onError }
}

describe('createEventBus', () => {
  it('hands a subscriber the typed payload of the events it subscribed to, and no others', async () => {
    const { bus } = aBus()
    const heard: number[] = []
    bus.subscribe(ping, (event) => {
      heard.push(event.n)
    })

    await bus.publish({ type: 'Ping', payload: { version: 1, n: 1 } })
    await bus.publish({ type: pong.type, payload: { version: 1, n: 2 } })
    expect(heard).toEqual([1])
  })

  it('delivers to every subscriber, in the order they subscribed, and waits for each', async () => {
    const { bus } = aBus()
    const order: string[] = []
    bus.subscribe(ping, async () => {
      await Promise.resolve()
      order.push('first')
    })
    bus.subscribe(ping, () => {
      order.push('second')
    })

    await bus.publish({ type: 'Ping', payload: { version: 1, n: 1 } })
    expect(order).toEqual(['first', 'second'])
  })

  it('stops delivering to a subscriber that unsubscribed', async () => {
    const { bus } = aBus()
    const listener = vi.fn<(payload: Ping) => void>()
    const unsubscribe = bus.subscribe(ping, listener)
    unsubscribe()

    await bus.publish({ type: 'Ping', payload: { version: 1, n: 1 } })
    expect(listener).not.toHaveBeenCalled()
  })

  it('may unsubscribe from inside a listener without skipping the next one', async () => {
    const { bus } = aBus()
    const second = vi.fn<(payload: Ping) => void>()
    const unsubscribe = bus.subscribe(ping, () => {
      unsubscribe()
    })
    bus.subscribe(ping, second)

    await bus.publish({ type: 'Ping', payload: { version: 1, n: 1 } })
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('reports a listener that throws or rejects, and still delivers to the rest', async () => {
    const { bus, onError } = aBus()
    const after = vi.fn<(payload: Ping) => void>()
    bus.subscribe(ping, () => {
      throw new Error('boom')
    })
    bus.subscribe(ping, () => Promise.reject(new Error('later')))
    bus.subscribe(ping, after)

    await expect(
      bus.publish({ type: 'Ping', payload: { version: 1, n: 1 } }),
    ).resolves.toBeUndefined()
    expect(after).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls[0]?.[1]).toEqual({ type: 'Ping', payload: { version: 1, n: 1 } })
  })

  it('leaves a payload it cannot read for a release that can, without failing', async () => {
    const { bus, onError } = aBus()
    const listener = vi.fn<(payload: Ping) => void>()
    bus.subscribe(ping, listener)

    await bus.publish({ type: 'Ping', payload: { version: 99 } })
    expect(listener).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('publishes to nobody without complaint', async () => {
    const { bus } = aBus()
    await expect(
      bus.publish({ type: 'Ping', payload: { version: 1, n: 1 } }),
    ).resolves.toBeUndefined()
  })
})
