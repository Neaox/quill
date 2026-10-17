import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/**
 * A typed, origin-checked `postMessage` channel to one embedded editor
 * (ADR-043; the external editor frame pattern of
 * `docs/extending/markdown-extensions.md`).
 *
 * Quill embeds editors it does not own — draw.io first, others later — in an
 * iframe on another origin, and the only line between them and the page is
 * `postMessage`. Every message the page receives is untrusted: any window can
 * post to it, a compromised frame can post anything, and a message's shape
 * is a claim. So a message is accepted only when all three hold:
 *
 * 1. it comes from the expected **origin** (`event.origin`, set by the
 *    browser, never by the sender);
 * 2. it comes from **this frame's window** (`event.source`), so another frame
 *    or tab on the same origin cannot drive this session;
 * 3. it **decodes** and **validates** against the protocol's TypeBox schema.
 *
 * Anything else is dropped and reported, never acted on. Messages out are
 * posted to that origin alone, never `'*'`, so a frame that has navigated
 * elsewhere receives nothing.
 *
 * Framework-free: a React component owns its lifecycle (`embedded-editor-
 * frame.tsx`), and a protocol adapter supplies the schema and the codec
 * (`../extensions/drawio/drawio-protocol.ts`). Only the adapter knows an
 * editor's protocol; this knows only that there is one.
 */

/** How messages are written on the wire: draw.io's `proto=json` is a JSON string, for example. */
export interface FrameCodec<Outbound> {
  encode(message: Outbound): unknown
  /** The message as data, or undefined when it is not one this protocol could have sent. */
  decode(data: unknown): unknown
}

/** Why a message was dropped, for the log and for tests; never shown to a reader. */
export type FrameRejection = 'origin' | 'source' | 'undecodable' | 'shape'

/** What a message is posted to: the frame's window, as far as the channel needs one. */
export interface FrameTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

export interface FrameChannelOptions<Inbound extends TSchema, Outbound> {
  /** The window that listens: the page's own. */
  readonly host: Pick<Window, 'addEventListener' | 'removeEventListener'>
  /** The embedded editor's window, read when a message arrives or is sent; null before it loads. */
  readonly target: () => FrameTarget | null
  /** The only origin messages are accepted from and sent to. */
  readonly origin: string
  /** Every message the editor may send. */
  readonly inbound: Inbound
  readonly codec: FrameCodec<Outbound>
  onMessage(message: Static<Inbound>): void
  onReject?(reason: FrameRejection, event: MessageEvent): void
}

export interface FrameChannel<Outbound> {
  /** Sends a message to the editor; false when its window is not there to receive it. */
  send(message: Outbound): boolean
  /** Stops listening. Messages after this are ignored. */
  dispose(): void
}

export function createFrameChannel<Inbound extends TSchema, Outbound>(
  options: FrameChannelOptions<Inbound, Outbound>,
): FrameChannel<Outbound> {
  const reject = (reason: FrameRejection, event: MessageEvent): void => {
    options.onReject?.(reason, event)
  }

  const listener = (event: MessageEvent): void => {
    if (event.origin !== options.origin) return reject('origin', event)
    const target = options.target()
    if (target === null || event.source !== target) return reject('source', event)
    const decoded = options.codec.decode(event.data)
    if (decoded === undefined) return reject('undecodable', event)
    if (!Value.Check(options.inbound, decoded)) return reject('shape', event)
    options.onMessage(decoded)
  }

  options.host.addEventListener('message', listener)
  let disposed = false

  return {
    send(message) {
      const target = options.target()
      if (disposed || target === null) return false
      target.postMessage(options.codec.encode(message), options.origin)
      return true
    },
    dispose() {
      disposed = true
      options.host.removeEventListener('message', listener)
    },
  }
}

/** The codec for protocols that send JSON as a string, as draw.io's `proto=json` does. */
export function jsonStringCodec<Outbound>(): FrameCodec<Outbound> {
  return {
    encode: (message) => JSON.stringify(message),
    decode: (data) => {
      if (typeof data !== 'string') return undefined
      try {
        const parsed: unknown = JSON.parse(data)
        return parsed
      } catch {
        return undefined
      }
    },
  }
}
