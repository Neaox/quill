import { mapValues } from 'remeda'
import { formatOklch } from './colour/oklch.ts'
import { fontFamilyName } from './css-string.ts'
import { PALETTE_TOKEN_ROLES, type Palette } from './colour/palette.ts'
import { curatedFace } from './schema/faces.ts'
import type {
  FaceReference,
  HeadingSettingValue,
  LinkSettingValue,
  ReadingScaleValue,
  ThemeDocument,
  ThemeShape,
} from './schema/theme-document.ts'
import {
  SYNTAX_CLASS_FAMILIES,
  type ProseToken,
  type SyntaxClass,
  type TokenMap,
  type TokenOverrides,
} from './tokens.ts'

/**
 * Layer 0 keeps the grid; the theme moves the gutter with its density and the
 * content column with its reading setting.
 */
const LAYOUT = { wide: '58rem', max: '84rem' } as const

/**
 * The shared reading setting, which is what `tokens.css` declares: 17 px at
 * 1.7 over a 38 rem column. A theme that states its own `type.scale` moves
 * the anchor; every size in `prose.css` is an `em` of it, so the proportions
 * of the scale never move (ADR-028, layer 0).
 */
export const DEFAULT_READING_SCALE = { size: 17, leading: 1.7, measure: 38 } as const

/** Root pixels per rem: the reading size is stated in pixels and served in rem. */
const ROOT_PX = 16

/** Enough places that 18.5 px survives as 1.15625rem, and no floating-point noise. */
const trimmed = (value: number): string => String(Number(value.toFixed(5)))

export type ReadingSetting = {
  readonly size: string
  readonly leading: string
  readonly measure: string
}

export const readingSetting = (scale: ReadingScaleValue | undefined): ReadingSetting => ({
  size: `${trimmed((scale?.size ?? DEFAULT_READING_SCALE.size) / ROOT_PX)}rem`,
  leading: trimmed(scale?.leading ?? DEFAULT_READING_SCALE.leading),
  measure: `${trimmed(scale?.measure ?? DEFAULT_READING_SCALE.measure)}rem`,
})

type HeadingTokens = {
  readonly size: string
  readonly leading: string
  readonly weight: string
  readonly tracking: string
}

/**
 * The shared prose scale, exactly as `prose.css` wrote it before themes could
 * move it, so a theme that states nothing renders as it always has.
 */
const DEFAULT_PROSE: Readonly<Record<ProseToken, string>> = {
  '--prose-lede-size': '1.1em',
  '--prose-lede-leading': '1.6',
  '--prose-h1-size': '2.074em',
  '--prose-h1-leading': '1.15',
  '--prose-h1-weight': '600',
  '--prose-h1-tracking': '-0.022em',
  '--prose-h2-size': '1.33em',
  '--prose-h2-leading': '1.25',
  '--prose-h2-weight': '600',
  '--prose-h2-tracking': '-0.014em',
  '--prose-h2-space': '2.6em',
  '--prose-h3-size': '1.14em',
  '--prose-h3-leading': '1.35',
  '--prose-h3-weight': '600',
  '--prose-h3-tracking': '-0.01em',
  '--prose-h3-space': '2em',
  '--prose-h4-size': '1em',
  '--prose-h4-leading': '1.45',
  '--prose-h4-weight': '600',
  '--prose-h4-tracking': '0em',
  '--prose-eyebrow-size': '0.76rem',
  '--prose-eyebrow-weight': '600',
  '--prose-eyebrow-tracking': '0.08em',
  '--prose-table-size': '0.88rem',
  '--prose-table-leading': '1.5',
  '--prose-code-size': '0.833rem',
  '--prose-link-colour': 'var(--palette-foreground)',
  '--prose-link-decoration': 'var(--palette-border-strong)',
  '--prose-link-thickness': 'from-font',
  '--prose-link-thickness-hover': 'from-font',
  '--prose-link-offset': '0.16em',
  '--prose-flow-block': '1.15em',
  '--prose-flow-after-heading': '0.75em',
  '--prose-flow-after-title': '0.75em',
  '--prose-flow-object-before': '1.6em',
  '--prose-flow-object-after': '1.6em',
}

const LINK_TEXT: Readonly<Record<LinkSettingValue['text'], string>> = {
  ink: 'var(--palette-foreground)',
  accent: 'var(--palette-accent-ink)',
}

const LINK_UNDERLINE: Readonly<Record<LinkSettingValue['underline'], string>> = {
  quiet: 'var(--palette-border-strong)',
  accent: 'var(--palette-accent)',
  current: 'currentColor',
}

const em = (px: number, body: number): string => `${trimmed(px / body)}em`

/**
 * A space between blocks as a multiple of the reading size. Not an `em`: the
 * block it sits above may be set smaller or larger than the body (a callout, a
 * lede), and the space a design states is the same either way; and not a
 * fixed length either, so a presentation that raises `--text-reading` raises
 * it too.
 */
const ofReading = (px: number, body: number): string =>
  `calc(${trimmed(px / body)} * var(--text-reading))`

const FLOW_TOKENS = [
  ['block', '--prose-flow-block'],
  ['afterHeading', '--prose-flow-after-heading'],
  ['afterTitle', '--prose-flow-after-title'],
  ['objectBefore', '--prose-flow-object-before'],
  ['objectAfter', '--prose-flow-object-after'],
] as const satisfies readonly (readonly [string, ProseToken])[]

/** The shared heading sizes `prose.css` falls back to, as a multiple of the body. */
const SHARED_HEADING_RATIO = { h2: 1.33, h3: 1.14 } as const

/**
 * A heading's size in pixels: the theme's own, or the shared one. The space
 * above a section is set on its heading, where an `em` is the heading's size
 * rather than the body's, so that space has to be measured against it.
 */
const headingPx = (
  level: keyof typeof SHARED_HEADING_RATIO,
  setting: HeadingSettingValue | undefined,
  body: number,
): number => setting?.size ?? SHARED_HEADING_RATIO[level] * body
const rem = (px: number): string => `${trimmed(px / ROOT_PX)}rem`
const pxOrFont = (px: number | undefined, fallback: string): string =>
  px === undefined ? fallback : `${trimmed(px)}px`

/**
 * The prose scale and the link treatment a theme states, as the custom
 * properties `prose.css` reads. Headings, the lede and the space above a
 * section are an `em` of the body, so the presentation surface still scales
 * them together; the furniture (eyebrow, tables, code) is in rem, as
 * `prose.css` already sets it, so it stays the interface's size.
 */
export const proseTokens = (
  scale: ReadingScaleValue | undefined,
  links: LinkSettingValue | undefined,
): Readonly<Record<ProseToken, string>> => {
  const body = scale?.size ?? DEFAULT_READING_SCALE.size
  const heading = (
    level: 'h1' | 'h2' | 'h3' | 'h4',
    setting: HeadingSettingValue | undefined,
  ): Partial<Record<ProseToken, string>> => {
    if (setting === undefined) return {}
    const tokens: HeadingTokens = {
      size: em(setting.size, body),
      leading: trimmed(setting.lineHeight / setting.size),
      weight: String(setting.weight ?? 600),
      tracking: `${trimmed(setting.tracking ?? 0)}em`,
    }
    return {
      [`--prose-${level}-size`]: tokens.size,
      [`--prose-${level}-leading`]: tokens.leading,
      [`--prose-${level}-weight`]: tokens.weight,
      [`--prose-${level}-tracking`]: tokens.tracking,
    }
  }
  const lede = scale?.lede
  const eyebrow = scale?.eyebrow
  const table = scale?.table
  return {
    ...DEFAULT_PROSE,
    ...(lede === undefined
      ? {}
      : {
          '--prose-lede-size': em(lede.size, body),
          '--prose-lede-leading': trimmed(lede.lineHeight / lede.size),
        }),
    ...heading('h1', scale?.h1),
    ...heading('h2', scale?.h2),
    ...heading('h3', scale?.h3),
    ...heading('h4', scale?.h4),
    ...(scale?.space?.h2 === undefined
      ? {}
      : { '--prose-h2-space': em(scale.space.h2, headingPx('h2', scale.h2, body)) }),
    ...(scale?.space?.h3 === undefined
      ? {}
      : { '--prose-h3-space': em(scale.space.h3, headingPx('h3', scale.h3, body)) }),
    ...Object.fromEntries(
      FLOW_TOKENS.flatMap(([step, token]) => {
        const px = scale?.flow?.[step]
        return px === undefined ? [] : [[token, ofReading(px, body)]]
      }),
    ),
    ...(eyebrow === undefined
      ? {}
      : {
          '--prose-eyebrow-size': rem(eyebrow.size),
          '--prose-eyebrow-weight': String(eyebrow.weight ?? 600),
          '--prose-eyebrow-tracking': `${trimmed(eyebrow.tracking ?? 0)}em`,
        }),
    ...(table === undefined
      ? {}
      : {
          '--prose-table-size': rem(table.size),
          '--prose-table-leading': trimmed(table.leading ?? 1.5),
        }),
    ...(scale?.code === undefined ? {} : { '--prose-code-size': rem(scale.code.size) }),
    ...(links === undefined
      ? {}
      : {
          '--prose-link-colour': LINK_TEXT[links.text],
          '--prose-link-decoration': LINK_UNDERLINE[links.underline],
          '--prose-link-thickness': pxOrFont(links.thickness, 'from-font'),
          '--prose-link-thickness-hover': pxOrFont(
            links.hoverThickness ?? links.thickness,
            'from-font',
          ),
          '--prose-link-offset': pxOrFont(links.offset, '0.16em'),
        }),
  }
}

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

const quote = fontFamilyName

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

/**
 * Whether an override stays inside the declaration it is written into.
 *
 * Generated values are the generator's own; an override is whatever a tenant
 * typed, and it is written into a stylesheet every page wears — the public
 * site's, which nobody signs in to read, included. A value that could end the
 * declaration, the block or a string, or open a comment, is not used, and the
 * generated value stands in its place.
 */
const isContainedValue = (value: string): boolean =>
  !/[;{}\\\n\r\f]|\/\*/u.test(value) &&
  (value.match(/'/gu)?.length ?? 0) % 2 === 0 &&
  (value.match(/"/gu)?.length ?? 0) % 2 === 0

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
  const reading = readingSetting(theme.type.scale)
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
    '--text-reading': reading.size,
    '--text-reading--line-height': reading.leading,
    '--leading-reading': reading.leading,

    ...proseTokens(theme.type.scale, theme.type.links),

    '--radius-sm': radius.sm,
    '--radius-md': radius.md,
    '--radius-lg': radius.lg,
    '--radius-xl': radius.xl,
    '--radius-2xl': radius.xl2,

    '--layout-content': reading.measure,
    '--layout-wide': LAYOUT.wide,
    '--layout-max': LAYOUT.max,
    '--layout-gutter': density.gutter,
    '--density-scale': density.scale,
  }

  const overrides = overridesFor(theme, palette.scheme)
  return mapValues(generated, (value, name) => {
    const override = overrides[name]
    return override !== undefined && isContainedValue(override) ? override : value
  })
}
