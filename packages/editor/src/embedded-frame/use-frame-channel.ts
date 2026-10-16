import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Static, TSchema } from '@sinclair/typebox'

import { createFrameChannel } from './frame-channel.ts'
import type { FrameChannel, FrameCodec, FrameRejection } from './frame-channel.ts'

/**
 * The frame channel (`frame-channel.ts`) for the life of a component: opened
 * when it mounts, closed when it unmounts, and talking to whatever window the
 * frame element holds at the time.
 *
 * The handlers are read through a box at the moment a message arrives, so the
 * channel is opened once and still calls the component's latest handlers —
 * the same reason `DocumentEditor` reads its callbacks through one.
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
  onReject?(reason: FrameRejection, event: MessageEvent): void
  readonly timeoutMs: number
  onSilent(): void
}

export function useFrameChannel<Inbound extends TSchema, Outbound>(
  options: UseFrameChannelOptions<Inbound, Outbound>,
): (message: Outbound) => boolean {
  const { frameRef, origin, inbound, codec, timeoutMs } = options
  const latest = useRef(options)
  const channel = useRef<FrameChannel<Outbound> | null>(null)

  // The window listener below lives outside React and reads this box when a
  // message arrives; after every render it is brought up to date.
  useEffect(() => {
    latest.current = options
  })

  // A window event listener and a timer: external systems, opened and closed
  // with the component.
  useEffect(() => {
    let heard = false
    const silence = setTimeout(() => {
      if (!heard) latest.current.onSilent()
    }, timeoutMs)
    const opened = createFrameChannel({
      host: window,
      target: () => frameRef.current?.contentWindow ?? null,
      origin,
      inbound,
      codec,
      onMessage: (message) => {
        heard = true
        latest.current.onMessage(message)
      },
      onReject: (reason, event) => latest.current.onReject?.(reason, event),
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
