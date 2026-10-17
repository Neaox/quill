import type { SlashItem, SlashPicker, SlashPickerOption } from './slash-item.ts'
import type { SlashSection } from './slash-sections.ts'

/**
 * The bridge between the suggestion plugin and React.
 *
 * `@tiptap/suggestion` is a ProseMirror plugin: it decides when a slash starts a
 * query and hands the result to an imperative renderer. React reads that through
 * `useSyncExternalStore`, so the menu is an ordinary component of an external
 * store rather than a component that sets state from an effect. The store is
 * plain TypeScript and is tested without rendering anything.
 *
 * It is in one of three states — closed, the menu, or an item's picker — and
 * the states are a discriminated union, so a picker with no command to run
 * cannot be represented.
 */

export interface SlashRect {
  readonly top: number
  readonly bottom: number
  readonly left: number
}

export interface SlashMenuState {
  readonly mode: 'menu'
  readonly query: string
  readonly sections: readonly SlashSection[]
  readonly rect: SlashRect | null
  /** Runs the item and removes the `/query` the author typed. */
  apply(item: SlashItem): void
}

export interface SlashPickerState {
  readonly mode: 'picker'
  readonly picker: SlashPicker
  readonly rect: SlashRect | null
  choose(option: SlashPickerOption): void
  /** Gives up, inserting nothing, and puts the caret back. */
  cancel(): void
}

export type SlashSnapshot = { readonly mode: 'closed' } | SlashMenuState | SlashPickerState

const CLOSED: SlashSnapshot = { mode: 'closed' }

export interface SlashStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): SlashSnapshot
  showMenu(state: Omit<SlashMenuState, 'mode'>): void
  showPicker(state: Omit<SlashPickerState, 'mode'>): void
  /** Closes the menu; a picker is left alone, because choosing an item that opens one closes the menu. */
  closeMenu(): void
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
    showMenu(state) {
      publish({ ...state, mode: 'menu' })
    },
    showPicker(state) {
      publish({ ...state, mode: 'picker' })
    },
    closeMenu() {
      if (snapshot.mode === 'menu') publish(CLOSED)
    },
    close() {
      if (snapshot.mode !== 'closed') publish(CLOSED)
    },
    setKeyHandler(handler) {
      keyHandler = handler
    },
    handleKey(key) {
      return snapshot.mode === 'menu' && keyHandler !== null ? keyHandler(key) : false
    },
  }
}
