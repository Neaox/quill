import { uniqueBy } from 'remeda'
import {
  ANALOGOUS_LIMIT,
  COMPLEMENTARY_BAND,
  LIGHTNESS_BANDS,
  SCHEMES,
  type Scheme,
} from '../colour/bands.ts'
import { hueDistance, normaliseHue } from '../colour/hue.ts'
import { formatOklch, parseColour, type Colour } from '../colour/oklch.ts'
import { buildPalettes, PALETTE_TOKEN_ROLES, type ThemePalettes } from '../colour/palette.ts'
import type { StatusName } from '../colour/status.ts'
import type { NeutralStepsValue, ThemeDocument } from '../schema/theme-document.ts'
import { PALETTE_TOKENS, TOKEN_NAMES, type TokenName, type TokenOverrides } from '../tokens.ts'
import { failingRoles, shortfall, SYNTAX_PREFIX, type Evidence } from './evidence.ts'
import { changeCost, isBrandRole, keepsTheBrand } from './feel.ts'
import type { DoctorOptions } from './rule.ts'
import { ALL_RULES } from './rules/all.ts'
import { reportOn, resolveDoctorOptions, type RuleResult } from './run.ts'

/**
 * Suggested fixes for a warning: concrete changes to the theme document's
 * seeds or overrides, each one re-generated and re-graded before it is
 * offered (ADR-028: the doctor advises; this makes the advice actionable).
 *
 * The shape is a strategy per lever. A lever is one thing a tenant can turn —
 * the accent intensity, the dark raised step, a token they overrode — and the
 * levers worth trying are found from the evidence: the roles the rule found
 * wanting say which levers move them. A numeric lever is searched for the
 * nearest value that clears the rule, assuming only that the rule clears
 * monotonically along it; nothing rests on that assumption, because every
 * candidate is then generated and run through the whole doctor,
 * and offered only if the rule no longer warns, nothing that held before
 * starts to warn, no warning that remains moves further from its target, and
 * the brand keeps its feel (`feel.ts`). No lever turns a brand hue.
 *
 * Generation is the expensive step, so the search is bounded: a budget of
 * palette builds per call, and nearest-first bisection rather than a scan.
 */

export type OverrideScope = 'shared' | Scheme

export type NeutralStep = keyof NeutralStepsValue

export type ThemeChange =
  | { readonly kind: 'accent-chroma'; readonly from: number; readonly to: number }
  | { readonly kind: 'tone-chroma'; readonly from: number; readonly to: number }
  | { readonly kind: 'tone-hue'; readonly from: number; readonly to: number }
  | {
      readonly kind: 'accent-lightness'
      readonly scheme: Scheme
      readonly from: number | undefined
      readonly to: number
    }
  | {
      readonly kind: 'neutral-step'
      readonly scheme: Scheme
      readonly role: NeutralStep
      readonly from: number | undefined
      readonly to: number
    }
  | {
      readonly kind: 'remove-override'
      readonly token: TokenName
      readonly role: string
      readonly scopes: readonly OverrideScope[]
    }
  | {
      readonly kind: 'override-colour'
      readonly token: TokenName
      readonly role: string
      readonly scopes: readonly OverrideScope[]
      readonly property: 'lightness' | 'chroma'
      readonly from: number
      readonly to: number
    }
  | { readonly kind: 'remove-status-overrides'; readonly statuses: readonly StatusName[] }
  | {
      /** The page, the panel and the raised surface of one scheme, moved together. */
      readonly kind: 'ground-shift'
      readonly scheme: Scheme
      readonly from: Readonly<Record<GroundRole, number>>
      readonly by: number
    }
  | { readonly kind: 'combined'; readonly changes: readonly ThemeChange[] }

/** The neutral surfaces a brand colour is seen on. */
export type GroundRole = 'paper' | 'surface' | 'raised'

const GROUND_ROLES: readonly GroundRole[] = ['paper', 'surface', 'raised']

export type Suggestion = {
  readonly change: ThemeChange
  /** The theme document with the change applied. */
  readonly document: ThemeDocument
  /** The rule as the doctor grades the changed document, evidence and all. */
  readonly result: RuleResult
}

const OVERRIDE_SCOPES: readonly OverrideScope[] = ['shared', 'light', 'dark']

const NEUTRAL_STEPS: readonly NeutralStep[] = [
  'paper',
  'surface',
  'raised',
  'border',
  'muted',
  'body',
  'ink',
]

const ACCENT_FAMILY: ReadonlySet<string> = new Set([
  'accentMark',
  'accent',
  'accentHover',
  'accentForeground',
  'accentSubtle',
  'accentInk',
  'focusRing',
  'selection',
])

const STATUS_FAMILY: Readonly<Record<string, StatusName>> = {
  success: 'success',
  successSubtle: 'success',
  warning: 'warning',
  warningSubtle: 'warning',
  danger: 'danger',
  dangerHover: 'danger',
  dangerSubtle: 'danger',
}

export type SuggestOptions = {
  /** How many fixes to offer at most. */
  readonly limit?: number
  /** How many palettes the search may generate before it settles for what it has. */
  readonly budget?: number
}

const isNeutralStep = (role: string): role is NeutralStep =>
  NEUTRAL_STEPS.some((step) => step === role)

const isTokenName = (name: string): name is TokenName => TOKEN_NAMES.some((token) => token === name)

const TOKEN_BY_ROLE = new Map<string, TokenName>(
  PALETTE_TOKENS.map((token) => [PALETTE_TOKEN_ROLES[token], token]),
)

const tokenFor = (role: string): TokenName | undefined => {
  const syntaxToken = `--${role}`
  return role.startsWith(SYNTAX_PREFIX) && isTokenName(syntaxToken)
    ? syntaxToken
    : TOKEN_BY_ROLE.get(role)
}

// ---------------------------------------------------------------------------
// Applying a change
// ---------------------------------------------------------------------------

type Overrides = NonNullable<ThemeDocument['overrides']>

const withOverrides = (theme: ThemeDocument, overrides: Overrides): ThemeDocument => {
  const kept = Object.fromEntries(
    Object.entries(overrides).filter(([, scope]) => Object.keys(scope).length > 0),
  )
  const { overrides: _previous, ...rest } = theme
  return Object.keys(kept).length === 0 ? rest : { ...rest, overrides: kept }
}

const rewriteOverride = (
  theme: ThemeDocument,
  token: TokenName,
  scopes: readonly OverrideScope[],
  rewrite: (value: string) => string | undefined,
): ThemeDocument => {
  const overrides: Overrides = { ...theme.overrides }
  for (const scope of scopes) {
    const current: TokenOverrides = overrides[scope] ?? {}
    const value = current[token]
    const others = Object.fromEntries(Object.entries(current).filter(([name]) => name !== token))
    const next = value === undefined ? undefined : rewrite(value)
    overrides[scope] = next === undefined ? others : { ...others, [token]: next }
  }
  return withOverrides(theme, overrides)
}

/**
 * Lightness is set; chroma is capped, because one saturation is applied to a
 * token in every scope it is overridden in, and lowering the strongest must
 * never raise the others.
 */
const overrideValue = (
  theme: ThemeDocument,
  scope: OverrideScope,
  token: TokenName,
): string | undefined => {
  const scoped: TokenOverrides = theme.overrides?.[scope] ?? {}
  return scoped[token]
}

const withColourProperty = (
  value: string,
  property: 'lightness' | 'chroma',
  to: number,
): string => {
  const colour = parseColour(value)
  if (colour === undefined) return value
  const next = property === 'chroma' ? Math.min(colour.chroma, to) : to
  return formatOklch({ ...colour, [property]: next })
}

const withoutStatusOverrides = (
  theme: ThemeDocument,
  statuses: readonly StatusName[],
): ThemeDocument => {
  const kept = Object.fromEntries(
    Object.entries(theme.seeds.statusOverrides ?? {}).filter(
      ([name]) => !statuses.some((status) => status === name),
    ),
  )
  const { statusOverrides: _previous, ...seeds } = theme.seeds
  return {
    ...theme,
    seeds: Object.keys(kept).length === 0 ? seeds : { ...seeds, statusOverrides: kept },
  }
}

/** The theme document with one suggested change made; everything else is untouched. */
export const applyThemeChange = (theme: ThemeDocument, change: ThemeChange): ThemeDocument => {
  const { seeds } = theme
  switch (change.kind) {
    case 'accent-chroma':
      return { ...theme, seeds: { ...seeds, accent: { ...seeds.accent, chroma: change.to } } }
    case 'tone-chroma':
      return { ...theme, seeds: { ...seeds, tone: { ...seeds.tone, chroma: change.to } } }
    case 'tone-hue':
      return { ...theme, seeds: { ...seeds, tone: { ...seeds.tone, hue: change.to } } }
    case 'accent-lightness': {
      const field = change.scheme === 'light' ? 'lightness' : 'darkLightness'
      return { ...theme, seeds: { ...seeds, accent: { ...seeds.accent, [field]: change.to } } }
    }
    case 'neutral-step': {
      const steps = seeds.tone.steps ?? {}
      const scheme = { ...steps[change.scheme], [change.role]: change.to }
      return {
        ...theme,
        seeds: {
          ...seeds,
          tone: { ...seeds.tone, steps: { ...steps, [change.scheme]: scheme } },
        },
      }
    }
    case 'remove-override':
      return rewriteOverride(theme, change.token, change.scopes, () => undefined)
    case 'override-colour':
      return rewriteOverride(theme, change.token, change.scopes, (value) =>
        withColourProperty(value, change.property, change.to),
      )
    case 'remove-status-overrides':
      return withoutStatusOverrides(theme, change.statuses)
    case 'ground-shift': {
      const steps = seeds.tone.steps ?? {}
      const shifted = Object.fromEntries(
        GROUND_ROLES.map((role) => [role, Number((change.from[role] + change.by).toFixed(1))]),
      )
      const scheme = { ...steps[change.scheme], ...shifted }
      return {
        ...theme,
        seeds: {
          ...seeds,
          tone: { ...seeds.tone, steps: { ...steps, [change.scheme]: scheme } },
        },
      }
    }
    case 'combined':
      return change.changes.reduce(applyThemeChange, theme)
  }
}

// ---------------------------------------------------------------------------
// Levers
// ---------------------------------------------------------------------------

/** Does the rule stop warning once this change is made? */
type Fixes = (change: ThemeChange) => boolean

type Lever = {
  readonly key: string
  readonly search: (fixes: Fixes) => ThemeChange | undefined
}

/** A lever with a short list of candidates, tried in order. */
const candidateLever = (key: string, candidates: readonly ThemeChange[]): Lever => ({
  key,
  search: (fixes) => candidates.find(fixes),
})

type Range = {
  readonly start: number
  readonly min: number
  readonly max: number
  readonly step: number
  /** How far from the start the search may go, in either direction. */
  readonly span: number
}

const placesFor = (step: number): number => Math.max(0, -Math.floor(Math.log10(step)))

/**
 * A continuous lever, searched outward from where it stands: the far end of
 * each direction first, then a bisection towards the start for the nearest
 * value that still clears the rule.
 */
const numericLever = (key: string, range: Range, change: (to: number) => ThemeChange): Lever => ({
  key,
  search: (fixes) => {
    const { start, min, max, step, span } = range
    const at = (direction: number, steps: number): ThemeChange =>
      change(Number((start + direction * steps * step).toFixed(placesFor(step))))
    const found = [-1, 1].flatMap((direction) => {
      const limit = Math.min(Math.max(start + direction * span, min), max)
      const reach = Math.floor(Math.abs(limit - start) / step + 1e-9)
      if (reach === 0 || !fixes(at(direction, reach))) return []
      let held = reach
      let failed = 0
      while (held - failed > 1) {
        const middle = Math.floor((held + failed) / 2)
        if (fixes(at(direction, middle))) held = middle
        else failed = middle
      }
      return [{ steps: held, change: at(direction, held) }]
    })
    const nearest = Math.min(...found.map((entry) => entry.steps))
    return found.find((entry) => entry.steps === nearest)?.change
  },
})

type OverriddenColour = { readonly scope: OverrideScope; readonly colour: Colour }

/** One saturation ceiling for the token in every scope it is overridden in, searched downwards. */
const overrideChromaLever = (
  token: TokenName,
  role: string,
  colours: readonly OverriddenColour[],
): Lever => {
  const from = Math.max(...colours.map((entry) => entry.colour.chroma))
  return numericLever(
    `chroma ${token}`,
    { start: from, min: 0, max: from, step: 0.005, span: from },
    (to) => ({
      kind: 'override-colour',
      token,
      role,
      scopes: colours.map((entry) => entry.scope),
      property: 'chroma',
      from,
      to,
    }),
  )
}

const overrideLevers = (
  theme: ThemeDocument,
  failing: readonly { readonly scheme: Scheme; readonly role: string }[],
): readonly Lever[] =>
  [...new Set(failing.map((entry) => entry.role))].flatMap((role) => {
    const token = tokenFor(role)
    if (token === undefined) return []
    const schemes = new Set(
      failing.filter((entry) => entry.role === role).map((entry) => entry.scheme),
    )
    const present = OVERRIDE_SCOPES.flatMap((scope) => {
      const value = overrideValue(theme, scope, token)
      const applies = scope === 'shared' || schemes.has(scope)
      return value !== undefined && applies ? [{ scope, value }] : []
    })
    if (present.length === 0) return []
    const scopes = present.map((entry) => entry.scope)
    const colours = present.flatMap(({ scope, value }) => {
      const colour = parseColour(value)
      return colour === undefined ? [] : [{ scope, colour }]
    })
    const chromaLevers = colours.length === 0 ? [] : [overrideChromaLever(token, role, colours)]
    return [
      candidateLever(`remove ${token}`, [{ kind: 'remove-override', token, role, scopes }]),
      ...chromaLevers,
      ...colours.map(({ scope, colour }) =>
        numericLever(
          `lightness ${token} ${scope}`,
          { start: colour.lightness, min: 0, max: 100, step: 0.5, span: 100 },
          (to) => ({
            kind: 'override-colour',
            token,
            role,
            scopes: [scope],
            property: 'lightness',
            from: colour.lightness,
            to,
          }),
        ),
      ),
    ]
  })

/** Every status override behind a failing status colour, dropped together. */
const statusOverrideLevers = (
  theme: ThemeDocument,
  failing: readonly { readonly role: string }[],
): readonly Lever[] => {
  const statuses = [...new Set(failing.flatMap((entry) => STATUS_FAMILY[entry.role] ?? []))].filter(
    (status) => theme.seeds.statusOverrides?.[status] !== undefined,
  )
  return statuses.length === 0
    ? []
    : [candidateLever('status overrides', [{ kind: 'remove-status-overrides', statuses }])]
}

const toneChromaLever = (theme: ThemeDocument): Lever => {
  const from = theme.seeds.tone.chroma
  return numericLever(
    'tone chroma',
    { start: from, min: 0, max: 0.04, step: 0.001, span: 0.04 },
    (to) => ({ kind: 'tone-chroma', from, to }),
  )
}

const seedLevers = (
  theme: ThemeDocument,
  palettes: ThemePalettes,
  failing: readonly { readonly scheme: Scheme; readonly role: string }[],
): readonly Lever[] =>
  failing.flatMap(({ scheme, role }) => {
    if (isNeutralStep(role)) {
      const from = theme.seeds.tone.steps?.[scheme]?.[role]
      return [
        numericLever(
          `step ${scheme} ${role}`,
          {
            start: from ?? palettes[scheme].colours[role].lightness,
            min: 0,
            max: 100,
            step: 0.5,
            span: 15,
          },
          (to) => ({ kind: 'neutral-step', scheme, role, from, to }),
        ),
        toneChromaLever(theme),
      ]
    }
    if (!ACCENT_FAMILY.has(role)) return []
    const { accent } = theme.seeds
    const from = scheme === 'light' ? accent.lightness : accent.darkLightness
    return [
      numericLever(
        'accent chroma',
        { start: accent.chroma, min: 0, max: 0.37, step: 0.005, span: 0.37 },
        (to) => ({ kind: 'accent-chroma', from: accent.chroma, to }),
      ),
      numericLever(
        `accent lightness ${scheme}`,
        {
          start: from ?? palettes[scheme].colours.accent.lightness,
          min: 0,
          max: 100,
          step: 0.5,
          span: 20,
        },
        (to) => ({ kind: 'accent-lightness', scheme, from, to }),
      ),
    ]
  })

/**
 * Rules whose evidence does not point at the lever that fixes them. A tone
 * that clashes with the accent is fixed by turning the tone's hue to an
 * analogous or complementary one, or by greying it out.
 */
const RULE_LEVERS: Readonly<Record<string, (theme: ThemeDocument) => readonly Lever[]>> = {
  'hue/neutral-accent-agreement': (theme) => {
    const { tone, accent } = theme.seeds
    const hues = [
      accent.hue - ANALOGOUS_LIMIT,
      accent.hue + ANALOGOUS_LIMIT,
      accent.hue + COMPLEMENTARY_BAND.low,
      accent.hue + COMPLEMENTARY_BAND.high,
    ].map((hue) => normaliseHue(Math.round(hue)))
    const nearest = hues.toSorted((a, b) => hueDistance(a, tone.hue) - hueDistance(b, tone.hue))
    return [
      candidateLever(
        'tone hue',
        nearest.map((to) => ({ kind: 'tone-hue', from: tone.hue, to })),
      ),
      toneChromaLever(theme),
    ]
  },
}

/** How far a scheme's ground may move, every role of it staying inside its lightness band. */
const groundRange = (from: Readonly<Record<GroundRole, number>>, scheme: Scheme): Range => {
  const down = Math.max(
    ...GROUND_ROLES.map((role) => LIGHTNESS_BANDS[role][scheme].low - from[role]),
  )
  const up = Math.min(
    ...GROUND_ROLES.map((role) => LIGHTNESS_BANDS[role][scheme].high - from[role]),
  )
  return { start: 0, min: Math.min(0, down), max: Math.max(0, up), step: 0.5, span: 8 }
}

const groundLever = (theme: ThemeDocument, palettes: ThemePalettes, scheme: Scheme): Lever => {
  const steps = theme.seeds.tone.steps?.[scheme]
  const from = {
    paper: steps?.paper ?? palettes[scheme].colours.paper.lightness,
    surface: steps?.surface ?? palettes[scheme].colours.surface.lightness,
    raised: steps?.raised ?? palettes[scheme].colours.raised.lightness,
  }
  return numericLever(`ground ${scheme}`, groundRange(from, scheme), (by) => ({
    kind: 'ground-shift',
    scheme,
    from,
    by,
  }))
}

/** A lever searched on top of a fixed first change: a little of the brand, the rest from the ground. */
const onTopOf = (first: ThemeChange, lever: Lever): Lever => ({
  key: `${JSON.stringify(first)} then ${lever.key}`,
  search: (fixes) => {
    const combine = (then: ThemeChange): ThemeChange => ({
      kind: 'combined',
      changes: [first, then],
    })
    const found = lever.search((then) => fixes(combine(then)))
    return found === undefined ? undefined : combine(found)
  },
})

/** How far a brand colour's lightness may be nudged as part of a fix that also moves the ground. */
const BRAND_NUDGE = 2

/**
 * The brand colour moved by a nudge, either way, for a ground shift to do the
 * rest: the tenant's override when they set one, the seed's otherwise.
 */
const brandNudges = (
  theme: ThemeDocument,
  palettes: ThemePalettes,
  scheme: Scheme,
  roles: ReadonlySet<string>,
): readonly ThemeChange[] =>
  [...roles].flatMap((role) => {
    const token = tokenFor(role)
    const value = token === undefined ? undefined : overrideValue(theme, scheme, token)
    const colour = value === undefined ? undefined : parseColour(value)
    if (token !== undefined && colour !== undefined) {
      return [-BRAND_NUDGE, BRAND_NUDGE].map((by): ThemeChange => ({
        kind: 'override-colour',
        token,
        role,
        scopes: [scheme],
        property: 'lightness',
        from: colour.lightness,
        to: colour.lightness + by,
      }))
    }
    if (role !== 'accent' && role !== 'accentInk') return []
    const { accent } = theme.seeds
    const from = scheme === 'light' ? accent.lightness : accent.darkLightness
    const start = from ?? palettes[scheme].colours.accent.lightness
    return [-BRAND_NUDGE, BRAND_NUDGE].map((by): ThemeChange => ({
      kind: 'accent-lightness',
      scheme,
      from,
      to: start + by,
    }))
  })

/**
 * The fixes that move the room rather than the colour: for a brand colour
 * that fails against a ground, the ground of that scheme alone, then a nudge
 * of the brand with the ground doing the rest. A dark problem moves only the
 * dark greys.
 */
const groundLevers = (
  theme: ThemeDocument,
  palettes: ThemePalettes,
  failing: readonly { readonly scheme: Scheme; readonly role: string }[],
): readonly Lever[] =>
  SCHEMES.flatMap((scheme) => {
    const roles = new Set(
      failing.filter((entry) => entry.scheme === scheme).map((entry) => entry.role),
    )
    const brand = new Set([...roles].filter(isBrandRole))
    if (brand.size === 0) return []
    const ground = groundLever(theme, palettes, scheme)
    return [
      ground,
      ...brandNudges(theme, palettes, scheme, brand).map((nudge) => onTopOf(nudge, ground)),
    ]
  })

const leversFor = (
  theme: ThemeDocument,
  palettes: ThemePalettes,
  ruleId: string,
  evidence: readonly Evidence[],
): readonly Lever[] => {
  const failing = failingRoles(evidence)
  const specific = RULE_LEVERS[ruleId]
  const levers = [
    ...overrideLevers(theme, failing),
    ...statusOverrideLevers(theme, failing),
    ...(specific === undefined ? seedLevers(theme, palettes, failing) : specific(theme)),
    ...groundLevers(theme, palettes, failing),
  ]
  return uniqueBy(levers, (lever) => lever.key)
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/**
 * Up to `limit` verified fixes for a rule that warns on this theme, the one
 * that keeps the brand closest to what the tenant had first (`brandDistance`).
 * A fix that turns the brand's hue or greys out one of its colours is never
 * offered (`keepsTheBrand`), so a rule that cannot be cleared without losing
 * the brand has none — which is the answer, not a gap: the tenant can accept
 * it (`acknowledgeRule`) instead.
 */
export const suggestFixes = (
  theme: ThemeDocument,
  ruleId: string,
  options?: Partial<DoctorOptions>,
  { limit = 3, budget = 48 }: SuggestOptions = {},
): readonly Suggestion[] => {
  const rule = ALL_RULES.find((candidate) => candidate.id === ruleId)
  if (rule === undefined) return []
  const resolved = resolveDoctorOptions(options)
  const palettes = buildPalettes(theme)
  const baseline = reportOn(theme, palettes, resolved)
  const current = baseline.results.find((result) => result.id === ruleId)
  if (current?.status !== 'warn') return []
  /** How far each warning already stands from its target; a fix may not take one further. */
  const tolerated = new Map(
    baseline.warnings.map((result) => [result.id, shortfall(result.evidence)] as const),
  )
  const worsens = (result: RuleResult): boolean => {
    const before = tolerated.get(result.id)
    return before === undefined || shortfall(result.evidence) > before + 1e-9
  }

  let builds = 0
  const fixes: Fixes = (change) => {
    if (builds >= budget) return false
    builds += 1
    const document = applyThemeChange(theme, change)
    return rule.evaluate(document, buildPalettes(document), resolved).status !== 'warn'
  }

  const verify = (change: ThemeChange): Ranked | undefined => {
    const document = applyThemeChange(theme, change)
    const changed = buildPalettes(document)
    if (!keepsTheBrand(palettes, changed)) return undefined
    const report = reportOn(document, changed, resolved)
    const regressed = report.warnings.some((warning) => warning.id === ruleId || worsens(warning))
    if (regressed) return undefined
    return report.results
      .filter((entry) => entry.id === ruleId)
      .map((result) => ({
        suggestion: { change, document, result },
        distance: changeCost(palettes, changed),
      }))[0]
  }

  return leversFor(theme, palettes, ruleId, current.evidence)
    .flatMap((lever) => {
      const change = lever.search(fixes)
      return change === undefined ? [] : (verify(change) ?? [])
    })
    .toSorted((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.suggestion)
}

type Ranked = { readonly suggestion: Suggestion; readonly distance: number }
