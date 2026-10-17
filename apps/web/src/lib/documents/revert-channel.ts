import { BRAND } from '@quill/brand'

/**
 * Putting changes back in a draft that an editor of this browser has open.
 *
 * While an editor holds the draft it is the draft: what it shows, what its undo history
 * covers, and what its next save writes. A change put back by a write from elsewhere would
 * arrive under it as a stale version to be merged, not as an edit its author can undo. So
 * the comparison page asks first: an editor of the same document in another tab of this
 * browser claims the request, applies it as one transaction of its own (Undo brings the
 * change back), saves it, and says how it went. When no editor answers, there is nobody
 * holding the draft in this browser, and the page writes the draft itself.
 *
 * The protocol is a request, a claim and an outcome over a `BroadcastChannel`, so it costs
 * nothing when no editor is open beyond a short wait for a claim that does not come. Every
 * message is checked before it is believed: a channel is same-origin, but its messages are
 * still data.
 */

export interface RevertRequest {
  /** The revision the changes are since: the published page; null before the first publish. */
  readonly from: string | null
  /** The version of the draft the comparison was made with. */
  readonly draftVersion: number
  /** The changes, by the ids the comparison gave them. */
  readonly changes: readonly string[]
}

export type RevertOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** What the asker hears: the editor's outcome, or that no editor answered. */
export type RevertAnswer = RevertOutcome | { readonly ok: 'no-editor' }

type Message =
  | { readonly kind: 'revert'; readonly requestId: string; readonly request: RevertRequest }
  | { readonly kind: 'claimed'; readonly requestId: string }
  | { readonly kind: 'reverted'; readonly requestId: string; readonly outcome: RevertOutcome }

/** How messages get from one tab to another: a `BroadcastChannel`, or memory in a test. */
export interface RevertTransport {
  post(message: unknown): void
  listen(listener: (message: unknown) => void): () => void
}

export interface RevertChannel {
  /** Asks an open editor to put the changes back, and waits for how it went. */
  ask(request: RevertRequest): Promise<RevertAnswer>
  /** Answers requests as the editor does; returns the unsubscribe. */
  serve(handler: (request: RevertRequest) => Promise<RevertOutcome>): () => void
}

/** How long an editor has to claim a request before the asker writes the draft itself. */
export const CLAIM_MS = 400
/** How long a claimed request may take, its save included. */
export const DONE_MS = 20_000

const NO_ANSWER = 'The open editor did not answer. Check it, then try again.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRequest(value: unknown): value is RevertRequest {
  return (
    isRecord(value) &&
    (value['from'] === null || typeof value['from'] === 'string') &&
    typeof value['draftVersion'] === 'number' &&
    Array.isArray(value['changes']) &&
    value['changes'].every((id) => typeof id === 'string')
  )
}

function isOutcome(value: unknown): value is RevertOutcome {
  return (
    isRecord(value) &&
    (value['ok'] === true || (value['ok'] === false && typeof value['message'] === 'string'))
  )
}

function readMessage(value: unknown): Message | undefined {
  if (!isRecord(value) || typeof value['requestId'] !== 'string') return undefined
  const requestId = value['requestId']
  switch (value['kind']) {
    case 'revert':
      return isRequest(value['request'])
        ? { kind: 'revert', requestId, request: value['request'] }
        : undefined
    case 'claimed':
      return { kind: 'claimed', requestId }
    case 'reverted':
      return isOutcome(value['outcome'])
        ? { kind: 'reverted', requestId, outcome: value['outcome'] }
        : undefined
    default:
      return undefined
  }
}

export function createRevertChannel(
  transport: RevertTransport,
  timing: { readonly claimMs?: number; readonly doneMs?: number } = {},
): RevertChannel {
  const { claimMs = CLAIM_MS, doneMs = DONE_MS } = timing
  return {
    ask(request) {
      const requestId = crypto.randomUUID()
      const { promise, resolve } = Promise.withResolvers<RevertAnswer>()
      let timer = setTimeout(() => {
        resolve({ ok: 'no-editor' })
      }, claimMs)
      const stop = transport.listen((raw) => {
        const message = readMessage(raw)
        if (message?.requestId !== requestId) return
        if (message.kind === 'claimed') {
          clearTimeout(timer)
          timer = setTimeout(() => {
            resolve({ ok: false, message: NO_ANSWER })
          }, doneMs)
        } else if (message.kind === 'reverted') {
          resolve(message.outcome)
        }
      })
      transport.post({ kind: 'revert', requestId, request } satisfies Message)
      return promise.finally(() => {
        clearTimeout(timer)
        stop()
      })
    },
    serve(handler) {
      return transport.listen((raw) => {
        const message = readMessage(raw)
        if (message?.kind !== 'revert') return
        transport.post({ kind: 'claimed', requestId: message.requestId } satisfies Message)
        void handler(message.request).then(
          (outcome) => {
            transport.post({ kind: 'reverted', requestId: message.requestId, outcome })
          },
          () => {
            transport.post({
              kind: 'reverted',
              requestId: message.requestId,
              outcome: {
                ok: false,
                message: 'Couldn’t put those changes back. Your draft is as it was.',
              },
            } satisfies Message)
          },
        )
      })
    },
  }
}

/** The channel the comparison page and the editors of one document meet on. */
export function revertChannelName(documentId: string): string {
  return `${BRAND.slug}-revert:${documentId}`
}

/**
 * A `BroadcastChannel` per listener, opened by `listen` and closed by its unsubscribe, so a
 * StrictMode double mount leaves nothing open. Where the API is missing nobody ever answers,
 * and the asker writes the draft itself, as it would with no editor open.
 */
export function broadcastRevertTransport(name: string): RevertTransport {
  return {
    post(message) {
      if (typeof BroadcastChannel === 'undefined') return
      const channel = new BroadcastChannel(name)
      // A BroadcastChannel is same-origin by construction and takes no target origin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      channel.postMessage(message)
      channel.close()
    },
    listen(listener) {
      if (typeof BroadcastChannel === 'undefined') return () => {}
      const channel = new BroadcastChannel(name)
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        listener(event.data)
      })
      return () => {
        channel.close()
      }
    },
  }
}

/** Transports that reach each other in memory, for tests of two "tabs". */
export function memoryRevertTransports(): { transport(): RevertTransport } {
  const all = new Set<{ readonly listeners: Set<(message: unknown) => void> }>()
  return {
    transport() {
      const own = { listeners: new Set<(message: unknown) => void>() }
      all.add(own)
      return {
        post(message) {
          // As a BroadcastChannel does, a message never reaches the tab that sent it.
          queueMicrotask(() => {
            for (const other of all) {
              if (other === own) continue
              for (const listener of other.listeners) listener(structuredClone(message))
            }
          })
        },
        listen(listener) {
          own.listeners.add(listener)
          return () => {
            own.listeners.delete(listener)
          }
        },
      }
    },
  }
}
