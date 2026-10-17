import { useState } from 'react'

/**
 * One of a few values, remembered for this viewer in this browser: the tab a
 * picker was last used on. A convenience, never state that matters, so a
 * storage that is missing, full or refused — a private window, blocked site
 * data — reads as the fallback and a write it refuses is ignored.
 *
 * A stored value that is no longer one of `values` (a tab that was renamed,
 * or one this instance does not offer) reads as the fallback too.
 */
export function useRememberedChoice<Value extends string>(
  key: string,
  values: readonly Value[],
  fallback: Value,
): readonly [Value, (value: Value) => void] {
  const [value, setValue] = useState<Value>(() => {
    const stored = readStored(key)
    return values.find((candidate) => candidate === stored) ?? fallback
  })

  function remember(next: Value) {
    setValue(next)
    try {
      globalThis.localStorage.setItem(key, next)
    } catch {
      // Not remembered, but still chosen for as long as this page is open.
    }
  }

  return [value, remember]
}

function readStored(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key)
  } catch {
    return null
  }
}
