/* oxlint-disable unicorn/require-post-message-target-origin -- a `BroadcastChannel` has no target origin: it is the origin's own. */
import { describe, expect, it, vi } from 'vitest'

import {
  createPresentChannel,
  isEnvelope,
  presentChannelName,
  type ChannelFactory,
  type BroadcastLike,
  type PresentEnvelope,
} from './present-channel.ts'

/** A bus whose ports hear every other port of the same name, as `BroadcastChannel`s do. */
function aBus(): ChannelFactory {
  const ports = new Map<string, Set<FakeChannel>>()
  class FakeChannel implements BroadcastLike {
    readonly listeners = new Set<(event: MessageEvent<unknown>) => void>()
    readonly name: string
    constructor(name: string) {
      this.name = name
      ports.set(name, (ports.get(name) ?? new Set()).add(this))
    }
    postMessage(message: unknown): void {
      for (const port of ports.get(this.name) ?? []) {
        if (port === this) continue
        for (const listener of port.listeners) listener({ data: message } as MessageEvent<unknown>)
      }
    }
    addEventListener(_: 'message', listener: (event: MessageEvent<unknown>) => void): void {
      this.listeners.add(listener)
    }
    removeEventListener(_: 'message', listener: (event: MessageEvent<unknown>) => void): void {
      this.listeners.delete(listener)
    }
    close(): void {
      ports.get(this.name)?.delete(this)
    }
  }
  return (name) => new FakeChannel(name)
}

describe('the presentation channel', () => {
  it('is named for the document, so two presentations never hear each other', () => {
    expect(presentChannelName('doc-1')).toMatch(/-present:doc-1$/u)
    expect(presentChannelName('doc-1')).not.toBe(presentChannelName('doc-2'))
  })

  it('carries a message from one window to the other, saying who it is from', () => {
    const bus = aBus()
    const audience = createPresentChannel('doc-1', 'audience-window', bus)
    const presenter = createPresentChannel('doc-1', 'presenter-window', bus)
    const heard = vi.fn<(message: PresentEnvelope) => void>()
    presenter.subscribe(heard)

    audience.post({ type: 'step', index: 3, revision: 'r1' })

    expect(heard).toHaveBeenCalledWith({
      type: 'step',
      index: 3,
      revision: 'r1',
      from: 'audience-window',
    })
  })

  it('never hears itself, which is what stops two windows echoing each other for ever', () => {
    const bus = aBus()
    const only = createPresentChannel('doc-1', 'me', bus)
    const heard = vi.fn<(message: PresentEnvelope) => void>()
    only.subscribe(heard)

    only.post({ type: 'step', index: 1, revision: 'r1' })

    expect(heard).not.toHaveBeenCalled()
  })

  it('does not carry a message to a presentation of another document', () => {
    const bus = aBus()
    const one = createPresentChannel('doc-1', 'a', bus)
    const other = createPresentChannel('doc-2', 'b', bus)
    const heard = vi.fn<(message: PresentEnvelope) => void>()
    other.subscribe(heard)

    one.post({ type: 'step', index: 1, revision: 'r1' })

    expect(heard).not.toHaveBeenCalled()
  })

  it('stops hearing once unsubscribed or closed', () => {
    const bus = aBus()
    const sender = createPresentChannel('doc-1', 'a', bus)
    const receiver = createPresentChannel('doc-1', 'b', bus)
    const heard = vi.fn<(message: PresentEnvelope) => void>()
    const stop = receiver.subscribe(heard)

    stop()
    sender.post({ type: 'step', index: 1, revision: 'r1' })
    expect(heard).not.toHaveBeenCalled()

    receiver.subscribe(heard)
    receiver.close()
    sender.post({ type: 'step', index: 2, revision: 'r1' })
    expect(heard).not.toHaveBeenCalled()
  })

  it('ignores anything on the channel that is not one of its messages', () => {
    const bus = aBus()
    const receiver = createPresentChannel('doc-1', 'b', bus)
    const heard = vi.fn<(message: PresentEnvelope) => void>()
    receiver.subscribe(heard)
    const stranger = bus(presentChannelName('doc-1'))

    stranger.postMessage('hello')
    stranger.postMessage({ type: 'launch-missiles', from: 'x' })
    stranger.postMessage({ type: 'step', index: 1, revision: 'r' })

    expect(heard).not.toHaveBeenCalled()
  })

  it('knows its own messages from others', () => {
    expect(isEnvelope({ type: 'bye', role: 'audience', from: 'a' })).toBe(true)
    expect(isEnvelope({ type: 'details', step: 1, revision: 'r', open: [true], from: 'a' })).toBe(
      true,
    )
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope({ type: 'step' })).toBe(false)
  })
})
