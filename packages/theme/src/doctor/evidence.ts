import { zip } from 'remeda'
import type { Adjustment, AdjustmentReason } from '../colour/adjustment.ts'
import { SCHEMES, type Scheme } from '../colour/bands.ts'
import type { Colour } from '../colour/oklch.ts'
import {
  PALETTE_ROLES,
  type Palette,
  type PaletteRole,
  type ThemePalettes,
} from '../colour/palette.ts'
import { SYNTAX_FAMILIES, type SyntaxFamily } from '../tokens.ts'
import { lcOf, ratioOf, type Pair } from './pairs.ts'

/**
 * What a rule judged, as data rather than as a sentence.
 *
 * A rule's `detail` says *that* something passed or failed; its evidence is
 * the colours it looked at, in both schemes, so a reader can be shown the
 * thing itself — body text on its surface, a focus ring on a button, the
 * accent before and after the generator moved it. Three shapes cover every
 * rule: a measured foreground on a background, a single colour held to a
 * band or a budget, and a colour the generator changed from what the seeds
 * asked for.
 *
 * Every role is named as the palette names it (`accentSubtle`, `raised`), and
 * a syntax colour as its adjustment log does (`token-keyword`), so the theme
 * editor can map a role to the token and the lever that controls it.
 */

/** What a measured pair is held to; an absent bound is not part of the rule. */
export type ContrastTarget = {
  readonly ratio?: number
  readonly lc?: number
  /** The ceiling of a band, for text that must stay quiet. */
  readonly lcAtMost?: number
}

export type Measurement = {
  readonly foreground: Colour
  readonly background: Colour
  readonly ratio: number
  readonly lc: number
  readonly holds: boolean
}

export type ContrastEvidence = {
  readonly kind: 'contrast'
  readonly label: string
  readonly foreground: string
  readonly background: string
  readonly target: ContrastTarget
  readonly light: Measurement
  readonly dark: Measurement
}

export type SwatchSample = {
  readonly colour: Colour
  readonly holds: boolean
  /** The surface the colour sits on, when it is drawn as a surface or a wash. */
  readonly ground?: Colour
  /** The text set on it, so a wash is judged as it is read: behind words. */
  readonly ink?: Colour
}

export type SwatchEvidence = {
  readonly kind: 'swatch'
  readonly role: PaletteRole
  readonly light: SwatchSample
  readonly dark: SwatchSample
}

/** A colour as the seeds asked for it, and as the generator shipped it. */
export type AdjustedColour = {
  readonly before: Colour
  readonly after: Colour
  readonly changes: readonly Adjustment[]
}

export type AdjustmentEvidence = {
  readonly kind: 'adjustment'
  readonly role: string
  readonly light?: AdjustedColour
  readonly dark?: AdjustedColour
}

export type Evidence = ContrastEvidence | SwatchEvidence | AdjustmentEvidence

const ROLE_NAMES = new Set<string>(PALETTE_ROLES)
const FAMILY_NAMES = new Set<string>(SYNTAX_FAMILIES)

export const isPaletteRole = (name: string): name is PaletteRole => ROLE_NAMES.has(name)

const isSyntaxFamily = (name: string): name is SyntaxFamily => FAMILY_NAMES.has(name)

/** How the adjustment log, and so the evidence, names a syntax colour. */
export const SYNTAX_PREFIX = 'token-'

const camelCase = (words: string): string =>
  words.replace(/[- ]+(\w)/g, (_match, letter: string) => letter.toUpperCase())

/**
 * A pair names its roles in its label ("accent ink on accent-subtle"), which
 * is the only way to tell a focus ring from the accent it is drawn in — they
 * are the same colour. Where the label's wording is not the role's name
 * ("strong border"), the colour itself is found in the palette.
 */
const roleOf = (name: string, colour: Colour, palette: Palette): string => {
  const named = camelCase(name)
  if (isPaletteRole(named)) return named
  const role = PALETTE_ROLES.find((candidate) => palette.colours[candidate] === colour)
  if (role !== undefined) return role
  const family = Object.entries(palette.syntax).find(([, value]) => value === colour)?.[0]
  return family === undefined ? named : `${SYNTAX_PREFIX}${family}`
}

const splitLabel = (label: string): readonly [string, string] => {
  const at = label.indexOf(' on ')
  return at === -1 ? [label, label] : [label.slice(0, at), label.slice(at + ' on '.length)]
}

export const meetsTarget = (ratio: number, lc: number, target: ContrastTarget): boolean =>
  (target.ratio === undefined || ratio >= target.ratio) &&
  (target.lc === undefined || lc >= target.lc) &&
  (target.lcAtMost === undefined || lc <= target.lcAtMost)

const measure = (pair: Pair, target: ContrastTarget): Measurement => {
  const ratio = ratioOf(pair)
  const lc = lcOf(pair)
  return {
    foreground: pair.foreground,
    background: pair.background,
    ratio,
    lc,
    holds: meetsTarget(ratio, lc, target),
  }
}

/**
 * Every pair a rule measures, in both schemes. The two lists are the same
 * pairs in the same order, because one function builds both.
 */
export const contrastEvidence = (
  palettes: ThemePalettes,
  pairsOf: (palette: Palette) => readonly Pair[],
  targetOf: (pair: Pair) => ContrastTarget = (pair) => pair.floor,
): readonly ContrastEvidence[] =>
  zip(pairsOf(palettes.light), pairsOf(palettes.dark)).map(([light, dark]) => {
    const [foreground, background] = splitLabel(light.label)
    const target = targetOf(light)
    return {
      kind: 'contrast',
      label: light.label,
      foreground: roleOf(foreground, light.foreground, palettes.light),
      background: roleOf(background, light.background, palettes.light),
      target,
      light: measure(light, target),
      dark: measure(dark, target),
    }
  })

type Context = { readonly ground?: Colour; readonly ink?: Colour }

/**
 * Where a surface or a wash is seen: on the page, or — a raised card in dark
 * mode, where elevation is lightness — on the panel it rises from, with the
 * text that is set on it; the page itself, with its text. A mark or a line
 * has no context of its own.
 */
const contextOf = (palette: Palette, role: PaletteRole): Context => {
  const { paper, surface, ink, accentInk, success, warning, danger } = palette.colours
  switch (role) {
    case 'paper':
      return { ink }
    case 'surface':
    case 'codeBackground':
    case 'selection':
      return { ground: paper, ink }
    case 'raised':
      return { ground: palette.scheme === 'light' ? paper : surface, ink }
    case 'accentSubtle':
      return { ground: paper, ink: accentInk }
    case 'successSubtle':
      return { ground: paper, ink: success }
    case 'warningSubtle':
      return { ground: paper, ink: warning }
    case 'dangerSubtle':
      return { ground: paper, ink: danger }
    default:
      return {}
  }
}

const sampleOf = <Role extends PaletteRole>(
  palette: Palette,
  role: Role,
  holds: (palette: Palette, role: Role) => boolean,
): SwatchSample => ({
  colour: palette.colours[role],
  holds: holds(palette, role),
  ...contextOf(palette, role),
})

/** Single colours, each held to whatever the rule holds it to in its scheme, in its context. */
export const swatchEvidence = <Role extends PaletteRole>(
  palettes: ThemePalettes,
  roles: readonly Role[],
  holds: (palette: Palette, role: Role) => boolean,
): readonly SwatchEvidence[] =>
  roles.map((role) => ({
    kind: 'swatch',
    role,
    light: sampleOf(palettes.light, role, holds),
    dark: sampleOf(palettes.dark, role, holds),
  }))

const colourOf = (palette: Palette, role: string): Colour | undefined => {
  if (isPaletteRole(role)) return palette.colours[role]
  const family = role.slice(SYNTAX_PREFIX.length)
  return role.startsWith(SYNTAX_PREFIX) && isSyntaxFamily(family)
    ? palette.syntax[family]
    : undefined
}

/**
 * The shipped colour with each changed property put back to where the seeds
 * first asked for it. Undoing the log from its end means a property changed
 * twice — lightened for contrast, then desaturated for the display — returns
 * to its first value.
 */
const adjustedColour = (
  palette: Palette,
  role: string,
  reasons: readonly AdjustmentReason[],
): AdjustedColour | undefined => {
  const changes = palette.adjustments.filter(
    (entry) => entry.role === role && reasons.includes(entry.reason),
  )
  const after = colourOf(palette, role)
  if (changes.length === 0 || after === undefined) return undefined
  const before = changes.reduceRight<Colour>(
    (colour, change) => ({ ...colour, [change.property]: change.from }),
    after,
  )
  return { before, after, changes }
}

/** Every role the generator moved for one of these reasons, before and after, per scheme. */
export const adjustmentEvidence = (
  palettes: ThemePalettes,
  reasons: readonly AdjustmentReason[],
): readonly AdjustmentEvidence[] => {
  const roles = new Set(
    [...palettes.light.adjustments, ...palettes.dark.adjustments]
      .filter((entry) => reasons.includes(entry.reason))
      .map((entry) => entry.role),
  )
  return [...roles].flatMap((role) => {
    const light = adjustedColour(palettes.light, role, reasons)
    const dark = adjustedColour(palettes.dark, role, reasons)
    if (light === undefined && dark === undefined) return []
    return [
      {
        kind: 'adjustment' as const,
        role,
        ...(light === undefined ? {} : { light }),
        ...(dark === undefined ? {} : { dark }),
      },
    ]
  })
}

const deficit = (actual: number, bound: number | undefined, below: boolean): number => {
  if (bound === undefined) return 0
  const gap = below ? bound - actual : actual - bound
  return Math.max(0, gap) / bound
}

const sampleShortfall = (entry: Evidence, scheme: Scheme): number => {
  if (entry.kind === 'adjustment') return 0
  if (entry.kind === 'swatch') return entry[scheme].holds ? 0 : 1
  const { ratio, lc } = entry[scheme]
  const { target } = entry
  return (
    deficit(ratio, target.ratio, true) +
    deficit(lc, target.lc, true) +
    deficit(lc, target.lcAtMost, false)
  )
}

/**
 * How far, in all, a rule's evidence is from its targets: each pair's gap to
 * every bound it misses, as a fraction of that bound, and one for each colour
 * outside its band or budget, in each scheme. Nought when everything holds.
 * It is what lets a suggested fix be refused for making some other warning
 * worse, not only for starting a new one.
 */
export const shortfall = (evidence: readonly Evidence[]): number =>
  evidence.reduce(
    (total, entry) =>
      total + SCHEMES.reduce((sum, scheme) => sum + sampleShortfall(entry, scheme), 0),
    0,
  )

/** The roles a rule found wanting, scheme by scheme — what a suggested fix has to move. */
export const failingRoles = (
  evidence: readonly Evidence[],
): readonly { readonly scheme: Scheme; readonly role: string }[] =>
  evidence.flatMap((entry) =>
    SCHEMES.flatMap((scheme) => {
      if (entry.kind === 'adjustment') return []
      const sample = entry[scheme]
      if (sample.holds) return []
      return entry.kind === 'contrast'
        ? [
            { scheme, role: entry.foreground },
            { scheme, role: entry.background },
          ]
        : [{ scheme, role: entry.role }]
    }),
  )
