import type { ThemeDocument } from '../schema/theme-document.ts'
import { SYNTAX_FAMILIES, type PaletteToken, type SyntaxFamily } from '../tokens.ts'
import { buildAccentVariants, type AccentRole } from './accent.ts'
import type { Adjustment } from './adjustment.ts'
import { DARK_CHROMA_REDUCTION, type Scheme } from './bands.ts'
import { NO_CEILING, type ChromaCeiling } from './derive.ts'
import { buildNeutralRamp, type NeutralRole } from './neutral-ramp.ts'
import { parseColour, withAlpha, type Colour } from './oklch.ts'
import { buildStatusSet, type StatusRole } from './status.ts'
import { buildSyntaxColours } from './syntax.ts'

export type EffectRole = 'overlay' | 'shadowAmbient' | 'shadowDirect'

export type PaletteRole = NeutralRole | AccentRole | StatusRole | EffectRole

export type Palette = {
  readonly scheme: Scheme
  readonly colours: Readonly<Record<PaletteRole, Colour>>
  readonly syntax: Readonly<Record<SyntaxFamily, Colour>>
  readonly adjustments: readonly Adjustment[]
}

export type ThemePalettes = { readonly light: Palette; readonly dark: Palette }

/** Every role a palette carries, in the order a report reads best. */
export const PALETTE_ROLES: readonly PaletteRole[] = [
  'paper',
  'surface',
  'raised',
  'border',
  'borderStrong',
  'muted',
  'ink',
  'codeBackground',
  'placeholder',
  'accentMark',
  'accent',
  'accentHover',
  'accentForeground',
  'accentSubtle',
  'focusRing',
  'selection',
  'success',
  'successSubtle',
  'warning',
  'warningSubtle',
  'danger',
  'dangerHover',
  'dangerSubtle',
  'info',
  'overlay',
  'shadowAmbient',
  'shadowDirect',
]

/** Section 7: shadows stop meaning anything on dark paper, so depth moves to lightness. */
const EFFECT_ALPHA = {
  light: { overlay: 0.4, ambient: 0.06, direct: 0.1 },
  dark: { overlay: 0.62, ambient: 0.32, direct: 0.44 },
} as const

const buildEffects = (
  scheme: Scheme,
  neutral: Readonly<Record<NeutralRole, Colour>>,
): Record<EffectRole, Colour> => {
  const alpha = EFFECT_ALPHA[scheme]
  return scheme === 'light'
    ? {
        overlay: withAlpha(neutral.ink, alpha.overlay),
        shadowAmbient: withAlpha(neutral.ink, alpha.ambient),
        shadowDirect: withAlpha(neutral.ink, alpha.direct),
      }
    : {
        overlay: { ...neutral.paper, lightness: 10, alpha: alpha.overlay },
        shadowAmbient: { lightness: 0, chroma: 0, hue: 0, alpha: alpha.ambient },
        shadowDirect: { lightness: 0, chroma: 0, hue: 0, alpha: alpha.direct },
      }
}

/** The one place a palette role and its custom property are tied together. */
export const PALETTE_TOKEN_ROLES: Readonly<Record<PaletteToken, PaletteRole>> = {
  '--palette-background': 'paper',
  '--palette-surface': 'surface',
  '--palette-surface-raised': 'raised',
  '--palette-foreground': 'ink',
  '--palette-muted': 'muted',
  '--palette-border': 'border',
  '--palette-border-strong': 'borderStrong',
  '--palette-accent': 'accent',
  '--palette-accent-hover': 'accentHover',
  '--palette-accent-foreground': 'accentForeground',
  '--palette-accent-subtle': 'accentSubtle',
  '--palette-success': 'success',
  '--palette-success-subtle': 'successSubtle',
  '--palette-warning': 'warning',
  '--palette-warning-subtle': 'warningSubtle',
  '--palette-danger': 'danger',
  '--palette-danger-hover': 'dangerHover',
  '--palette-danger-subtle': 'dangerSubtle',
  '--palette-code-background': 'codeBackground',
  '--palette-selection': 'selection',
  '--palette-overlay': 'overlay',
  '--palette-shadow-ambient': 'shadowAmbient',
  '--palette-shadow-direct': 'shadowDirect',
}

const DARK_CEILING = 1 - DARK_CHROMA_REDUCTION.chosen

/**
 * Section 7: dark mode is a re-derivation, not an inversion. Every dark colour
 * is held to its light counterpart's chroma less the reduction the rules ask
 * for, and the ceiling is applied to the seed rather than to the result, so
 * the colour the contrast floors were checked against is the colour emitted.
 */
const colourCeiling = <Role extends PaletteRole>(
  reference: Palette | undefined,
): ChromaCeiling<Role> =>
  reference === undefined ? NO_CEILING : (role) => reference.colours[role].chroma * DARK_CEILING

const syntaxCeiling = (reference: Palette | undefined): ChromaCeiling<SyntaxFamily> =>
  reference === undefined ? NO_CEILING : (family) => reference.syntax[family].chroma * DARK_CEILING

const buildScheme = (document: ThemeDocument, scheme: Scheme, reference?: Palette): Palette => {
  const neutral = buildNeutralRamp(document.seeds.tone, scheme, colourCeiling(reference))
  const accent = buildAccentVariants(
    document.seeds.accent,
    scheme,
    neutral.colours,
    colourCeiling(reference),
  )
  const status = buildStatusSet(
    accent.colours.accent,
    document.seeds.accent.hue,
    scheme,
    neutral.colours,
    document.seeds.statusOverrides ?? {},
    colourCeiling(reference),
  )
  const syntax = buildSyntaxColours(
    {
      tone: document.seeds.tone.hue,
      success: status.colours.success.hue,
      danger: status.colours.danger.hue,
    },
    scheme,
    neutral.colours.codeBackground,
    syntaxCeiling(reference),
  )

  return {
    scheme,
    colours: {
      ...neutral.colours,
      ...accent.colours,
      ...status.colours,
      ...buildEffects(scheme, neutral.colours),
    },
    syntax: syntax.colours,
    adjustments: [
      ...neutral.adjustments,
      ...accent.adjustments,
      ...status.adjustments,
      ...syntax.adjustments,
    ],
  }
}

const ROLE_BY_TOKEN = new Map<string, PaletteRole>(Object.entries(PALETTE_TOKEN_ROLES))

const SYNTAX_TOKEN_FAMILIES: Readonly<Record<string, SyntaxFamily>> = Object.fromEntries(
  SYNTAX_FAMILIES.map((family) => [`--token-${family}`, family]),
)

const applyColourOverrides = (
  palette: Palette,
  overrides: Readonly<Record<string, string>>,
): Palette => {
  const entries = Object.entries(overrides)
  if (entries.length === 0) return palette
  const colours = { ...palette.colours }
  const syntax = { ...palette.syntax }
  for (const [token, value] of entries) {
    const parsed = parseColour(value)
    if (parsed === undefined) continue
    const role = ROLE_BY_TOKEN.get(token)
    if (role !== undefined) colours[role] = parsed
    const family = SYNTAX_TOKEN_FAMILIES[token]
    if (family !== undefined) syntax[family] = parsed
  }
  return { ...palette, colours, syntax }
}

const overridesFor = (
  document: ThemeDocument,
  scheme: Scheme,
): Readonly<Record<string, string>> => ({
  ...document.overrides?.shared,
  ...document.overrides?.[scheme],
})

/**
 * Generate both palettes from the seeds. Tenant token overrides are folded in
 * here, not afterwards, so the doctor grades the colours that will actually
 * ship rather than the ones the seeds would have produced.
 */
export const buildPalettes = (document: ThemeDocument): ThemePalettes => {
  const light = applyColourOverrides(
    buildScheme(document, 'light'),
    overridesFor(document, 'light'),
  )
  const dark = applyColourOverrides(
    buildScheme(document, 'dark', light),
    overridesFor(document, 'dark'),
  )
  return { light, dark }
}
