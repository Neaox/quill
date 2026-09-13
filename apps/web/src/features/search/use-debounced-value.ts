import { useEffect, useState } from 'react'

/**
 * A value as it is after a pause.
 *
 * Typeahead is the one place a keystroke should *not* immediately become a
 * request: six letters typed quickly are one search, not six, and the
 * difference is a rate limit and a flickering list. The pause is a timer, an
 * external system, which is what the effect here synchronises with (ADR-013,
 * AGENTS.md rule 6) — the state it sets is the timer's output, not a step in a
 * chain of effects.
 *
 * Each new value replaces the pending timer rather than queuing behind it, so
 * a long burst of typing produces exactly one update, `delayMs` after the last
 * keystroke. Unmounting cancels it.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  /* Synchronises with a timer, the external system the pause itself is:
     each new value replaces the pending timeout rather than queuing behind
     it, and unmounting cancels it. */
  useEffect(() => {
    const handle = setTimeout(() => {
      setSettled(value)
    }, delayMs)
    return () => {
      clearTimeout(handle)
    }
  }, [value, delayMs])

  return settled
}
