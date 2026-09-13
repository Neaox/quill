import type { SlashItem } from './slash-items.ts'

/**
 * The bridge between the suggestion plugin and React.
 *
 * `@tiptap/suggestion` is a ProseMirror plugin: it decides when a slash starts a
 * query and hands the result to an imperative renderer. React reads that through
 * `useSyncExternalStore`, so the menu is an ordinary component of an external
 * store rather than a component that sets state from an effect. The store is
 * plain TypeScript and is tested without rendering anything.
 */

export interface SlashRect {
  readonly top: number
  readonly bottom: number
  readonly left: number
}

export interface SlashSnapshot {
  readonly open: boolean
  readonly query: string
  readonly items: readonly SlashItem[]
  readonly rect: SlashRect | null
  /** Runs the item and removes the `/query` the author typed. */
  apply(item: SlashItem): void
}

const CLOSED: SlashSnapshot = {
  open: false,
  query: '',
  items: [],
  rect: null,
  apply: () => {},
}

export type SlashOpenState = Omit<SlashSnapshot, 'open'>

export interface SlashStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): SlashSnapshot
  open(state: SlashOpenState): void
  close(): void
  /** The menu lends the store its keyboard handling while the menu is shown. */
  setKeyHandler(handler: ((key: string) => boolean) | null): void
  handleKey(key: string): boolean
}

export function createSlashStore(): SlashStore {
  const listeners = new Set<() => void>()
  let snapshot: SlashSnapshot = CLOSED
  let keyHandler: ((key: string) => boolean) | null = null

  const publish = (next: SlashSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    open(state) {
      publish({ ...state, open: true })
    },
    close() {
      if (snapshot.open) publish(CLOSED)
    },
    setKeyHandler(handler) {
      keyHandler = handler
    },
    handleKey(key) {
      return snapshot.open && keyHandler !== null ? keyHandler(key) : false
    },
  }
}
