import { useEffect, useState } from 'react'

import { applyThemeId, DEFAULT_THEME_ID } from '@quill/ui/theme'

import type { BuiltinThemeId } from '@quill/theme'

export interface ThemeIdController {
  readonly themeId: BuiltinThemeId
  readonly setThemeId: (id: BuiltinThemeId) => void
}

/**
 * Owns the identity on screen and keeps the document in step with it.
 *
 * Deliberately not remembered. A tenant's identity comes from the workspace
 * that published a document (ADR-028, layer 1), so this is a preview control,
 * not a preference: the design showcase uses it, and the theme editor will.
 * The identity is React state; `data-theme-id` on the document element is an
 * external system, which is exactly what the effect is for.
 */
export function useThemeId(initial: BuiltinThemeId = DEFAULT_THEME_ID): ThemeIdController {
  const [themeId, setThemeId] = useState<BuiltinThemeId>(initial)

  // Synchronises the document element, an external system React does not
  // render, with the identity being previewed (ADR-028).
  useEffect(() => {
    applyThemeId(document.documentElement, themeId)
  }, [themeId])

  return { themeId, setThemeId }
}
