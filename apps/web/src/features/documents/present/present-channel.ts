/* oxlint-disable unicorn/require-post-message-target-origin -- a `BroadcastChannel` has no target origin: it is the origin's own. */
import { BRAND } from '@quill/brand'

import type { SlideEntry } from './present-state.ts'

/**
 * The two windows of a presentation, and how they follow each other (ADR-050).
 *
 * A `BroadcastChannel` named for the document connects every window of this browser that is
 * presenting it: nothing leaves the machine, and neither window has to be the one that opened the
 * other. Messages are small and say only what is needed to follow along.
 */

export type PresentRole = 'audience' | 'presenter'

/** What a window says on the channel. `from` is added by the channel, so a sender cannot forget it. */
export type PresentMessage =
  /** I have just opened: I am here, and on this step of this revision. */
  | {
      readonly type: 'hello'
      readonly role: PresentRole
      readonly index: number
      readonly revision: string
    }
  /** The presentation is now on this step. */
  | {
      readonly type: 'step'
      readonly index: number
      readonly revision: string
      /** Which end of the slide it starts at; absent is its top, as it was before this was said. */
      readonly entry?: SlideEntry
    }
  /** The screen the room sees is black (or is back): the presenter pausing the room's attention. */
  | { readonly type: 'blank'; readonly blank: boolean }
  /**
   * A section of a slide was opened or folded: whether each of the slide's sections is now open, in
   * order, which names the same ones in both windows because both draw the same HTML. Also how a
   * window that has just opened is told what the room has opened.
   */
  | {
      readonly type: 'details'
      readonly step: number
      readonly revision: string
      readonly open: readonly boolean[]
    }
  /** The presenter asks the audience window to close (it is single-window again). */
  | { readonly type: 'close-presenter' }
  /** I am closing. */
  | { readonly type: 'bye'; readonly role: PresentRole }

export type PresentEnvelope = PresentMessage & { readonly from: string }

/** The part of `BroadcastChannel` this uses, so a test can stand in for it. */
export interface BroadcastLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  close(): void
}

export type ChannelFactory = (name: string) => BroadcastLike

export interface PresentChannel {
  /** Names this window on the channel; messages from it carry it, and it never hears itself. */
  readonly id: string
  post(message: PresentMessage): void
  /** Calls `listener` for every message from another window; returns the way to stop. */
  subscribe(listener: (message: PresentEnvelope) => void): () => void
  close(): void
}

/** The channel's name: one per document, so two presentations never hear each other. */
export function presentChannelName(documentId: string): string {
  return `${BRAND.slug}-present:${documentId}`
}

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'step',
  'blank',
  'details',
  'close-presenter',
  'bye',
])

/** Whether something that arrived on the channel is one of ours: a channel is open to anything on the origin. */
export function isEnvelope(value: unknown): value is PresentEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    MESSAGE_TYPES.has(value.type) &&
    'from' in value &&
    typeof value.from === 'string'
  )
}

const browserChannel: ChannelFactory = (name) => new BroadcastChannel(name)

export function createPresentChannel(
  documentId: string,
  id: string,
  factory: ChannelFactory = browserChannel,
): PresentChannel {
  const port = factory(presentChannelName(documentId))
  return {
    id,
    post: (message) => {
      port.postMessage({ ...message, from: id })
    },
    subscribe: (listener) => {
      const onMessage = (event: MessageEvent<unknown>): void => {
        if (isEnvelope(event.data) && event.data.from !== id) listener(event.data)
      }
      port.addEventListener('message', onMessage)
      return () => {
        port.removeEventListener('message', onMessage)
      }
    },
    close: () => {
      port.close()
    },
  }
}
