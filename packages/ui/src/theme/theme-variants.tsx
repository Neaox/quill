import { createContext, use, useMemo, type ReactNode } from 'react'

/*
 * `@quill/theme/builtin`, not `@quill/theme`: the package's main entry reaches
 * the schema validator and the theme doctor, which belong to the theme editor
 * and would otherwise be in the bundle of every reader who opens a document
 * (review 2026-09-13, H1). This context is the one thing in the design system
 * that needs a theme document at runtime, and all it needs is the data.
 */
import {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  type BuiltinThemeId,
  type ThemeVariants,
} from '@quill/theme/builtin'

/**
 * Which signature variant each component should render (ADR-028, layer 1).
 *
 * The variants are a property of the theme, so a feature never picks one: it
 * composes `Tree`, `RevisionTimeline`, and the rest, and the identity in scope
 * decides whether history is a timeline or a menu. A component still takes an
 * explicit `variant` prop, because a preview — the theme editor, the design
 * showcase — has to be able to show a variant the surrounding page is not in.
 */
const ThemeVariantsContext = createContext<ThemeVariants>(DEFAULT_THEME.variants)

export interface ThemeVariantsProviderProps {
  /** The identity whose variants apply below this point. */
  readonly themeId: BuiltinThemeId
  readonly children: ReactNode
}

export function ThemeVariantsProvider({ themeId, children }: ThemeVariantsProviderProps) {
  // The variants are the theme document's own object, so this is stable
  // already; the memo says so to anything reading the call rather than the
  // function it calls.
  const variants = useMemo(() => BUILTIN_THEMES[themeId].variants, [themeId])

  return <ThemeVariantsContext value={variants}>{children}</ThemeVariantsContext>
}

/** The variants in scope. Defaults to the default identity's. */
export function useThemeVariants(): ThemeVariants {
  return use(ThemeVariantsContext)
}
