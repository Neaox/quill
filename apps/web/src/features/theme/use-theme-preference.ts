import { useCallback, useEffect, useState } from 'react'

import {
  applyThemePreference,
  readThemePreference,
  writeThemePreference,
  type ThemePreference,
} from '@quill/ui'

export interface ThemeController {
  readonly preference: ThemePreference
  readonly setPreference: (preference: ThemePreference) => void
}

/**
 * Owns the theme preference and keeps the document in step with it.
 *
 * The preference is React state; the `data-theme` attribute and the stored
 * value are external systems, which is exactly what the effect is for. The
 * effect never sets state, so there is no chain to follow.
 *
 * `system` is represented by the absence of the attribute rather than by a
 * resolved value, so a change to the operating system setting is picked up by
 * CSS alone, with no listener and no re-render.
 */
export function useThemePreference(): ThemeController {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(globalThis.localStorage),
  )

  // Synchronises the document element, an external system React does not
  // render, with the reader's chosen scheme.
  useEffect(() => {
    applyThemePreference(document.documentElement, preference)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(globalThis.localStorage, next)
    setPreferenceState(next)
  }, [])

  return { preference, setPreference }
}
