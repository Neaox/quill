import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import type { RefObject } from 'react'
import type { Static, TSchema } from '@sinclair/typebox'

import { createFrameChannel } from './frame-channel.ts'
import type { FrameChannel, FrameCodec } from './frame-channel.ts'

/**
 * The frame channel (`frame-channel.ts`) for the life of a component: opened
 * when it mounts, closed when it unmounts, and talking to whatever window the
 * frame element holds at the time.
 *
 * The handlers are effect events (`useEffectEvent`), so the channel is opened
 * once and still calls the component's latest handlers when a message
 * arrives, without reopening on every render.
 *
 * `timeoutMs` bounds the wait for the editor's first message: an editor that
 * never answers — not running, blocked, the wrong address — is reported
 * through `onSilent` rather than leaving a spinner up for ever.
 */

export interface UseFrameChannelOptions<Inbound extends TSchema, Outbound> {
  readonly frameRef: RefObject<HTMLIFrameElement | null>
  readonly origin: string
  readonly inbound: Inbound
  readonly codec: FrameCodec<Outbound>
  onMessage(message: Static<Inbound>): void
  readonly timeoutMs: number
  onSilent(): void
}

export function useFrameChannel<Inbound extends TSchema, Outbound>(
  options: UseFrameChannelOptions<Inbound, Outbound>,
): (message: Outbound) => boolean {
  const { frameRef, origin, inbound, codec, timeoutMs } = options
  const channel = useRef<FrameChannel<Outbound> | null>(null)
  const onMessage = useEffectEvent((message: Static<Inbound>) => options.onMessage(message))
  const onSilent = useEffectEvent(() => options.onSilent())

  // Synchronises with the window's message events and a timer: the channel
  // and the wait for the editor's first word open and close with the component.
  useEffect(() => {
    const silence = setTimeout(onSilent, timeoutMs)
    const opened = createFrameChannel({
      host: window,
      target: () => frameRef.current?.contentWindow ?? null,
      origin,
      inbound,
      codec,
      onMessage: (message) => {
        clearTimeout(silence)
        onMessage(message)
      },
    })
    channel.current = opened
    return () => {
      clearTimeout(silence)
      opened.dispose()
      channel.current = null
    }
  }, [frameRef, origin, inbound, codec, timeoutMs])

  return useCallback((message: Outbound) => channel.current?.send(message) ?? false, [])
}
