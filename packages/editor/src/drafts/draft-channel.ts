/**
 * Tells the other tabs of this browser that a draft was saved (audit
 * 2026-10-11, P0-5).
 *
 * Two tabs of the same user hold the same lock, because the lock belongs to
 * the session. The server's version check stops a stale tab from overwriting,
 * but only on its next save; this lets the stale tab say so the moment the
 * other one writes, before its author types into a draft that has moved on.
 *
 * An observer in the catalogue's shape: `subscribe` returns the unsubscribe.
 */
export interface DraftSavedMessage {
  readonly draftVersion: number
}

export interface DraftChannel {
  publish(message: DraftSavedMessage): void
  subscribe(listener: (message: DraftSavedMessage) => void): () => void
}

function isDraftSavedMessage(value: unknown): value is DraftSavedMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'draftVersion' in value &&
    typeof value.draftVersion === 'number'
  )
}

/**
 * A `BroadcastChannel` per subscription, opened in `subscribe` and closed by
 * its unsubscribe, so a StrictMode double mount leaves nothing open. A
 * `BroadcastChannel` never delivers to the object that posted, so a tab does
 * not hear its own saves. Where the API is missing this does nothing, which
 * is the old behaviour: the version check still catches the stale write.
 */
export function createBroadcastDraftChannel(name: string): DraftChannel {
  let open: BroadcastChannel | undefined
  return {
    publish(message) {
      // A BroadcastChannel is same-origin by construction and takes no
      // target origin; the rule is written for `window.postMessage`.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      open?.postMessage(message)
    },
    subscribe(listener) {
      if (typeof BroadcastChannel === 'undefined') return () => {}
      const channel = new BroadcastChannel(name)
      open = channel
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (isDraftSavedMessage(event.data)) listener(event.data)
      })
      return () => {
        if (open === channel) open = undefined
        channel.close()
      }
    },
  }
}

/** Channels that reach each other in memory, for tests of several "tabs". */
export function createMemoryDraftChannels(): { channel(): DraftChannel } {
  const listeners = new Map<DraftChannel, Set<(message: DraftSavedMessage) => void>>()
  return {
    channel() {
      const own = new Set<(message: DraftSavedMessage) => void>()
      const channel: DraftChannel = {
        publish(message) {
          for (const [other, set] of listeners) {
            if (other === channel) continue
            for (const listener of set) listener(message)
          }
        },
        subscribe(listener) {
          own.add(listener)
          return () => {
            own.delete(listener)
          }
        },
      }
      listeners.set(channel, own)
      return channel
    },
  }
}
