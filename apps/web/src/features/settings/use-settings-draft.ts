import { useCallback, useState } from 'react'

export interface SettingsDraft<T> {
  /** What is in the form. */
  readonly value: T
  /**
   * The revision this draft was forked from, and the one a save states as its
   * `expectedRevision`.
   *
   * It belongs to the draft, not to the query. Reading it live from the cache
   * would mean a background refetch — TanStack Query refetches on window focus
   * — could replace it with the revision *another* administrator had just
   * saved, and the next save would then compare-and-swap against theirs and be
   * accepted, silently overwriting them with no `409` and nothing on screen.
   * Held here, the comparison is always against the document this person
   * actually started from, which is what the compare-and-swap is for
   * (`docs/architecture/api-contract-settings.md`).
   */
  readonly revision: string | null
  /** Records a change, and marks the draft as having one. */
  readonly change: (next: T) => void
  /** Replaces the draft and its base revision, and forgets that anything was changed. */
  readonly reset: (next: T, revision: string | null) => void
  /**
   * Keeps the edits and adopts a new base revision: the deliberate overwrite
   * the conflict notice offers, where somebody has read what the other person
   * saved and decided to replace it anyway. It is a separate, named step for
   * exactly the reason above — a revision must never move under a draft by
   * accident, only because somebody said so.
   */
  readonly adoptRevision: (revision: string | null) => void
  /** True once something has been changed and not yet saved or reloaded. */
  readonly dirty: boolean
}

interface DraftState<T> {
  readonly value: T
  readonly revision: string | null
  readonly dirty: boolean
}

/**
 * The editing state every settings screen has: what is in the form, the
 * revision it was read at, and whether it differs from what was loaded.
 *
 * "Differs" is **recorded**, not computed. A settings document holds a whole
 * theme — every seed, every token override — so a deep comparison on every
 * keystroke would be the most expensive thing on the screen, and it would
 * answer a question nobody asked: what a Save button needs to know is whether
 * this person has changed anything, which is exactly what a change handler
 * running says. Typing a value and typing the old one back leaves the draft
 * dirty, and saving it writes a revision that changes nothing; that is a
 * cheaper wrong answer than the alternative, and the only one that can be
 * wrong in the harmless direction.
 */
export function useSettingsDraft<T>(initial: T, initialRevision: string | null): SettingsDraft<T> {
  const [state, setState] = useState<DraftState<T>>({
    value: initial,
    revision: initialRevision,
    dirty: false,
  })

  const change = useCallback((next: T) => {
    setState((previous) => ({ value: next, revision: previous.revision, dirty: true }))
  }, [])

  const reset = useCallback((next: T, revision: string | null) => {
    setState({ value: next, revision, dirty: false })
  }, [])

  const adoptRevision = useCallback((revision: string | null) => {
    setState((previous) => ({ ...previous, revision }))
  }, [])

  return {
    value: state.value,
    revision: state.revision,
    change,
    reset,
    adoptRevision,
    dirty: state.dirty,
  }
}
