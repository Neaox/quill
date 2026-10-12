import { useRef } from 'react'

export interface StableKeys {
  /** The React key for this object, made the first time it is asked for. */
  readonly keyOf: (item: object) => string
  /** Gives `next` the key `previous` had: the same row, edited. */
  readonly carry: (previous: object, next: object) => void
}

/**
 * React keys for the rows of a list whose items have no ids of their own.
 *
 * A menu item is a value — a label and a target — with nothing that names it
 * across edits, and its position is exactly what dragging and moving change,
 * so neither its content nor its index can be its key without the field being
 * typed into losing focus. Keys are kept by object identity instead: a moved
 * item is the same object and keeps its key, and an edit, which makes a new
 * object, carries the old object's key across.
 *
 * Filling the map lazily during render is idempotent — asking twice gives the
 * same answer — which is what makes a ref the right home for it.
 */
export function useStableKeys(prefix: string): StableKeys {
  const keys = useRef(new WeakMap<object, string>())
  const made = useRef(0)

  const keyOf = (item: object): string => {
    const known = keys.current.get(item)
    if (known !== undefined) return known
    made.current += 1
    const key = `${prefix}-${made.current}`
    keys.current.set(item, key)
    return key
  }

  return {
    keyOf,
    carry: (previous, next) => {
      keys.current.set(next, keyOf(previous))
    },
  }
}
