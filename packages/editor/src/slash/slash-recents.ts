/**
 * The blocks an author inserted last, shown first when the menu opens with
 * nothing typed, as Notion does.
 *
 * Remembered per person in the browser's own storage: the application names
 * the key (it knows who is signed in), and the editor only reads and writes
 * it. Storage can be missing, full, or refused — a private window, a
 * blocked site — so every access is guarded and a failure simply forgets.
 * What is remembered is a convenience; nothing depends on it.
 */

export interface SlashRecents {
  /** Item ids, most recent first. */
  read(): readonly string[]
  remember(id: string): void
}

/** How many are kept, and shown. */
export const RECENT_LIMIT = 5

/** The key an editor uses when the application gives none. */
export const DEFAULT_RECENTS_KEY = 'editor.slash.recent'

/** Where the emoji chosen last are kept: beside the slash menu's own, which are blocks, not emoji. */
export function emojiRecentsKey(key: string = DEFAULT_RECENTS_KEY): string {
  return `${key}.emoji`
}

function parse(stored: string | null): readonly string[] {
  if (stored === null) return []
  try {
    const value: unknown = JSON.parse(stored)
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, RECENT_LIMIT)
      : []
  } catch {
    return []
  }
}

/** The browser's local storage, or null where touching it throws. */
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/** Recents kept in a `Storage` under one key; the browser's local storage unless told otherwise. */
export function createSlashRecents(
  key: string = DEFAULT_RECENTS_KEY,
  storage: Storage | null = browserStorage(),
): SlashRecents {
  const read = (): readonly string[] => {
    try {
      return parse(storage?.getItem(key) ?? null)
    } catch {
      return []
    }
  }
  return {
    read,
    remember(id) {
      const next = [id, ...read().filter((known) => known !== id)].slice(0, RECENT_LIMIT)
      try {
        storage?.setItem(key, JSON.stringify(next))
      } catch {
        // Full or refused: this one is not remembered, which is all that is lost.
      }
    },
  }
}
