import { mapValues } from 'remeda'
import { formatOklch } from './colour/oklch.ts'
import { PALETTE_TOKEN_ROLES, type Palette } from './colour/palette.ts'
import { curatedFace } from './schema/faces.ts'
import type { FaceReference, ThemeDocument, ThemeShape } from './schema/theme-document.ts'
import {
  SYNTAX_CLASS_FAMILIES,
  type SyntaxClass,
  type TokenMap,
  type TokenOverrides,
} from './tokens.ts'

/** Layer 0 keeps the grid; the theme only moves the gutter with its density. */
const LAYOUT = { content: '38rem', wide: '58rem', max: '84rem' } as const

const DENSITY = {
  comfortable: { gutter: '1.5rem', scale: '1' },
  compact: { gutter: '1.125rem', scale: '0.875' },
} as const satisfies Record<ThemeShape['density'], { gutter: string; scale: string }>

/** The radius scale of `tokens.css` is step 2; the other steps scale it. */
const RADIUS_FACTORS = [0, 0.5, 1, 1.5, 2] as const

export type RadiusScale = {
  readonly sm: string
  readonly md: string
  readonly lg: string
  readonly xl: string
  readonly xl2: string
}

export const radiusScale = (step: number): RadiusScale => {
  const factor = RADIUS_FACTORS[step] ?? 1
  const at = (value: number): string => (factor === 0 ? '0' : `${value * factor}rem`)
  return { sm: at(0.25), md: at(0.375), lg: at(0.5), xl: at(0.75), xl2: at(1) }
}

const quote = (family: string): string => (family.includes(' ') ? `'${family}'` : family)

/** The CSS font stack for a face, curated or uploaded. */
export const fontStack = (face: FaceReference): string => {
  if (face.source === 'uploaded') return `${quote(face.family)}, ${face.generic}`
  const curated = curatedFace(face.id)
  return [quote(curated.family), ...curated.fallbacks.map(quote)].join(', ')
}

/**
 * A class that is its own family declares the colour; every other class is a
 * reference to the family's variable, so each colour is written once.
 */
const syntax = (name: SyntaxClass, palette: Palette): string => {
  const family = SYNTAX_CLASS_FAMILIES[name]
  return name === family ? formatOklch(palette.syntax[family]) : `var(--token-${family})`
}

const overridesFor = (theme: ThemeDocument, scheme: Palette['scheme']): TokenOverrides => ({
  ...theme.overrides?.shared,
  ...theme.overrides?.[scheme],
})

/**
 * One scheme's custom properties. The keys are exactly the names
 * `packages/ui/src/styles/tokens.css` resolves, so a theme is a palette swap
 * and never a rebuild. Tenant overrides are applied last and can only replace
 * a token the generator emits, never introduce one.
 */
export const toTokenMap = (theme: ThemeDocument, palette: Palette): TokenMap => {
  const radius = radiusScale(theme.shape.radiusStep)
  const density = DENSITY[theme.shape.density]
  const generated: TokenMap = {
    ...mapValues(PALETTE_TOKEN_ROLES, (role) => formatOklch(palette.colours[role])),

    '--token-punctuation': syntax('punctuation', palette),
    '--token-operator': syntax('operator', palette),
    '--token-comment': syntax('comment', palette),
    '--token-keyword': syntax('keyword', palette),
    '--token-important': syntax('important', palette),
    '--token-tag': syntax('tag', palette),
    '--token-selector': syntax('selector', palette),
    '--token-bold': syntax('bold', palette),
    '--token-number': syntax('number', palette),
    '--token-boolean': syntax('boolean', palette),
    '--token-null': syntax('null', palette),
    '--token-constant': syntax('constant', palette),
    '--token-symbol': syntax('symbol', palette),
    '--token-string': syntax('string', palette),
    '--token-template-string': syntax('template-string', palette),
    '--token-attr-value': syntax('attr-value', palette),
    '--token-url': syntax('url', palette),
    '--token-italic': syntax('italic', palette),
    '--token-function': syntax('function', palette),
    '--token-class-name': syntax('class-name', palette),
    '--token-title': syntax('title', palette),
    '--token-variable': syntax('variable', palette),
    '--token-property': syntax('property', palette),
    '--token-attr-name': syntax('attr-name', palette),
    '--token-builtin': syntax('builtin', palette),
    '--token-regex': syntax('regex', palette),
    '--token-interpolation': syntax('interpolation', palette),
    '--token-inserted': syntax('inserted', palette),
    '--token-deleted': syntax('deleted', palette),

    '--font-display': fontStack(theme.type.display),
    '--font-sans': fontStack(theme.type.interface),
    '--font-reading': fontStack(theme.type.reading),
    '--font-mono': fontStack(theme.type.mono),

    '--radius-sm': radius.sm,
    '--radius-md': radius.md,
    '--radius-lg': radius.lg,
    '--radius-xl': radius.xl,
    '--radius-2xl': radius.xl2,

    '--layout-content': LAYOUT.content,
    '--layout-wide': LAYOUT.wide,
    '--layout-max': LAYOUT.max,
    '--layout-gutter': density.gutter,
    '--density-scale': density.scale,
  }

  const overrides = overridesFor(theme, palette.scheme)
  return mapValues(generated, (value, name) => overrides[name] ?? value)
}
