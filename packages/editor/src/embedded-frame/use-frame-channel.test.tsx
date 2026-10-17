import { Type } from '@sinclair/typebox'
import { act, render } from '@testing-library/react'
import { createRef, useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { jsonStringCodec } from './frame-channel.ts'
import { useFrameChannel } from './use-frame-channel.ts'

/**
 * The hook that holds a frame channel for the life of a component: what it
 * tells the component about a frame that answers, one that stays silent, and
 * one that is not there.
 */

const ORIGIN = 'https://editor.example.com'
const TIMEOUT_MS = 5_000
const Inbound = Type.Object({ event: Type.Literal('hello') })
type Outbound = { readonly action: 'greet' }

afterEach(() => {
  vi.useRealTimers()
})

interface Probe {
  readonly send: (message: Outbound) => boolean
}

function mount(framed = true) {
  const onMessage = vi.fn<(message: { readonly event: 'hello' }) => void>()
  const onSilent = vi.fn<() => void>()
  const probe = createRef<Probe>()

  function Host({ ref }: { ref: Ref<Probe> }) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const send = useFrameChannel({
      frameRef,
      origin: ORIGIN,
      inbound: Inbound,
      codec: jsonStringCodec<Outbound>(),
      onMessage,
      timeoutMs: TIMEOUT_MS,
      onSilent,
    })
    useImperativeHandle(ref, () => ({ send }), [send])
    return framed ? <iframe ref={frameRef} title="Editor" sandbox="" /> : null
  }

  const view = render(<Host ref={probe} />)
  const frame = view.container.querySelector('iframe')
  // Taken at once, so that it can be called after the component has gone.
  const sendFromHook = probe.current?.send
  const send = (message: Outbound): boolean => sendFromHook?.(message) ?? false
  const hear = (frameWindow: Window | null) => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event: 'hello' }),
          origin: ORIGIN,
          source: frameWindow,
        }),
      )
    })
  }
  return { ...view, frame, send, hear, onMessage, onSilent }
}

describe('the frame channel of a component', () => {
  it('passes on what the frame says, and posts to the frame on its origin', () => {
    const { frame, send, hear, onMessage } = mount()
    const frameWindow = frame?.contentWindow ?? null
    if (frameWindow === null) throw new Error('The frame has no window.')
    const posted = vi.spyOn(frameWindow, 'postMessage').mockImplementation(() => {})

    hear(frameWindow)
    const sent = send({ action: 'greet' })

    expect(onMessage).toHaveBeenCalledWith({ event: 'hello' })
    expect(sent).toBe(true)
    expect(posted).toHaveBeenCalledWith('{"action":"greet"}', ORIGIN)
  })

  it('reports a frame that says nothing within the time it was given', () => {
    vi.useFakeTimers()
    const { onSilent } = mount()

    vi.advanceTimersByTime(TIMEOUT_MS - 1)
    expect(onSilent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSilent).toHaveBeenCalledOnce()
  })

  it('does not report silence for a frame that has spoken', () => {
    vi.useFakeTimers()
    const { frame, hear, onSilent } = mount()

    hear(frame?.contentWindow ?? null)
    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onSilent).not.toHaveBeenCalled()
  })

  it('has nobody to post to when the frame is not there, or the component has gone', () => {
    const missing = mount(false)
    expect(missing.send({ action: 'greet' })).toBe(false)

    const gone = mount()
    gone.unmount()
    expect(gone.send({ action: 'greet' })).toBe(false)
  })

  it('never reports silence after the component has gone', () => {
    vi.useFakeTimers()
    const { unmount, onSilent } = mount()

    unmount()
    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onSilent).not.toHaveBeenCalled()
  })
})
