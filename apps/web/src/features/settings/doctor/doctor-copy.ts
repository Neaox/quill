import {
  hueDistance,
  severityCounts,
  type GroundRole,
  type NeutralStep,
  type Severity,
  type ThemeChange,
  type Verdict,
} from '@quill/theme'

/**
 * The theme doctor in plain words.
 *
 * The rules in `@quill/theme` are written for the people who maintain them —
 * OKLCH chroma, APCA Lc, lightness bands — and that vocabulary stays, behind
 * a "Details" line. What an administrator reads first is here: what each
 * rule looks at, what each role is called on a page, and what a suggested
 * change does, in the words the theme editor's own levers use.
 */

export type DoctorSummary = Verdict

interface RuleCopy {
  /** What the rule looks at, as a heading. */
  readonly title: string
  /** One sentence on why it matters. */
  readonly about: string
}

const RULE_COPY: Readonly<Record<string, RuleCopy>> = {
  'legibility/text-contrast': {
    title: 'Text is easy to read',
    about: 'Every kind of text stands out clearly from the surface it sits on.',
  },
  'legibility/ui-boundaries': {
    title: 'Focus rings and borders are visible',
    about: 'Keyboard focus and the edges of controls can be seen on every surface.',
  },
  'legibility/decorative-text': {
    title: 'Placeholder text stays quiet',
    about: 'Hints in empty fields can be read when you look, without competing with real text.',
  },
  'legibility/text-on-accent': {
    title: 'Buttons are readable',
    about: 'Text on an accent-coloured button uses whichever of light or dark reads best.',
  },
  'legibility/dark-ink-and-paper': {
    title: 'Dark mode is easy on the eyes',
    about: 'Dark mode avoids pure white text and a pure black page, which glare.',
  },
  'legibility/labels': {
    title: 'Labels are readable',
    about: 'Every label reads on every surface and on its own pill, in both schemes.',
  },
  'uniformity/ramp-hue-constant': {
    title: 'Greys keep one undertone',
    about: 'Every grey, from the page to the text, shares the same warm or cool cast.',
  },
  'uniformity/gamut-mapped': {
    title: 'Colours fit ordinary screens',
    about: 'Colours too vivid for most displays are softened rather than clipped.',
  },
  'uniformity/chroma-compensation': {
    title: 'Status colours feel equally strong',
    about: 'Green, amber and red are balanced so none of them shouts louder than the others.',
  },
  'bands/role-lightness': {
    title: 'Every colour fits its job',
    about: 'Pages, panels, text and the accent each sit in the lightness range their job needs.',
  },
  'bands/surface-separation': {
    title: 'Panels stand apart from the page',
    about: 'Panels and raised cards are far enough from the page to be seen without a shadow.',
  },
  'chroma/area-budget': {
    title: 'Large areas stay calm',
    about: 'Pages, panels and tinted backgrounds carry only a hint of colour.',
  },
  'chroma/accent-budget': {
    title: 'The accent has the right strength',
    about: 'The accent is vivid enough to find and calm enough to read beside.',
  },
  'chroma/one-saturated-thing': {
    title: 'One colour leads',
    about: 'Only the accent and the status colours are vivid, so nothing competes with them.',
  },
  'hue/neutral-accent-agreement': {
    title: 'Greys suit the accent',
    about:
      'A tinted grey sits close to the accent’s hue or opposite it, never at an awkward angle.',
  },
  'hue/status-set': {
    title: 'Status colours stay distinct from the accent',
    about: 'Success, warning and danger keep their meaning and are not mistaken for a link.',
  },
  'hue/status-matched': {
    title: 'Status colours are a matched set',
    about:
      'Success, warning and danger differ in hue alone, so none looks more urgent by accident.',
  },
  'proportion/accent-coverage': {
    title: 'The accent is used sparingly',
    about: 'The accent covers a small part of a page, so it still draws the eye.',
  },
  'dark/rederivation': {
    title: 'Dark mode keeps the same colours',
    about: 'Dark mode uses the same hues, a little softer, rather than an inverted copy.',
  },
  'dark/elevation': {
    title: 'Dark mode shows depth with light',
    about: 'In dark mode, raised things are lighter, because shadows vanish on a dark page.',
  },
  'dark/contrast-recheck': {
    title: 'Dark mode is as readable as light',
    about: 'Every pairing that reads in light mode is measured again in dark mode.',
  },
  'cvd/status-separation': {
    title: 'Status reads without colour vision',
    about:
      'Success and danger stay apart for people with colour blindness, helped by icons and words.',
  },
  'cvd/accent-separation': {
    title: 'Links stand out without colour vision',
    about: 'Links stay distinguishable from quiet text for people with colour blindness.',
  },
}

/** A rule this file does not know yet keeps its own title, so a new rule is never blank. */
export function ruleCopy(id: string, fallbackTitle: string): RuleCopy {
  return RULE_COPY[id] ?? { title: fallbackTitle, about: '' }
}

const ROLE_NAMES: Readonly<Record<string, string>> = {
  paper: 'the page',
  surface: 'a panel',
  raised: 'a raised card',
  border: 'borders',
  borderStrong: 'strong borders',
  muted: 'secondary text',
  body: 'body text',
  ink: 'headings',
  codeBackground: 'code blocks',
  placeholder: 'placeholder text',
  accentMark: 'the brand mark',
  accent: 'the accent',
  accentHover: 'the accent on hover',
  accentForeground: 'button text',
  accentSubtle: 'the accent wash',
  accentInk: 'accent text',
  focusRing: 'the focus ring',
  selection: 'selected text',
  success: 'success',
  successSubtle: 'the success wash',
  warning: 'warning',
  warningSubtle: 'the warning wash',
  danger: 'danger',
  dangerHover: 'danger on hover',
  dangerSubtle: 'the danger wash',
  info: 'information',
}

/** What a palette role is called on a page; a syntax colour is named by its token. */
export function roleName(role: string): string {
  return ROLE_NAMES[role] ?? `${role.replace(/^token-/, '')} in code`
}

export function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** "Body text on the page". */
export function pairName(foreground: string, background: string): string {
  return capitalise(`${roleName(foreground)} on ${roleName(background)}`)
}

/** A neutral step as the theme's lightness steps name it, after "the light" or "the dark". */
const STEP_NAMES: Readonly<Record<NeutralStep, string>> = {
  paper: 'page',
  surface: 'panel',
  raised: 'raised surface',
  border: 'border',
  muted: 'secondary text',
  body: 'body text',
  ink: 'heading text',
}

const SCHEME_PHRASES = { light: ' in light mode', dark: ' in dark mode' } as const

/** " in dark mode" for one scheme; nothing for the shared scope or for both. */
function schemePhrase(scopes: readonly ('shared' | 'light' | 'dark')[]): string {
  const [only, ...others] = scopes
  return only === undefined || only === 'shared' || others.length > 0 ? '' : SCHEME_PHRASES[only]
}

/** "the accent wash" without its article, for "the generated accent wash". */
function bareName(role: string): string {
  return roleName(role).replace(/^the /, '')
}

/** " a little" when a change moves a value by a quarter or less of where it was. */
function aLittle(from: number | undefined, to: number): string {
  return from !== undefined && from !== 0 && Math.abs(to - from) / Math.abs(from) <= 0.25
    ? ' a little'
    : ''
}

function rising(from: number | undefined, to: number): boolean {
  return from === undefined || to > from
}

/** The hue greys read warmest at; turning towards it warms them, away from it cools them. */
const WARMEST_HUE = 60

const GROUND_NAMES: readonly (readonly [GroundRole, string])[] = [
  ['paper', 'page'],
  ['surface', 'panel'],
  ['raised', 'raised surface'],
]

type GroundShift = Extract<ThemeChange, { kind: 'ground-shift' }>

function groundPhrase(change: GroundShift): string {
  return `make the ${change.scheme} page a touch ${change.by > 0 ? 'lighter' : 'darker'} behind it`
}

/**
 * A suggested change as a plain instruction — "Make the accent wash a little
 * quieter in dark mode", "Keep your teal and make the dark page a touch
 * lighter behind it" — in the words the theme editor's own controls use. A
 * change to the greys says the brand colour stays, because that is the
 * point of it. The numbers are in `describeChangeDetail`.
 */
export function describeChange(change: ThemeChange, brandColour: string): string {
  const keep = `Keep your ${brandColour} and`
  switch (change.kind) {
    case 'accent-chroma':
      return `Make the accent${aLittle(change.from, change.to)} ${rising(change.from, change.to) ? 'more vivid' : 'quieter'}`
    case 'tone-chroma':
      return rising(change.from, change.to)
        ? `${keep} give the greys${aLittle(change.from, change.to)} more tint`
        : `${keep} make the greys${aLittle(change.from, change.to)} more neutral`
    case 'tone-hue':
      return `${keep} ${hueDistance(change.to, WARMEST_HUE) < hueDistance(change.from, WARMEST_HUE) ? 'warm' : 'cool'} the greys slightly`
    case 'accent-lightness':
      return `Make the ${change.scheme} accent${aLittle(change.from, change.to)} ${rising(change.from, change.to) ? 'lighter' : 'darker'}`
    case 'neutral-step':
      return `${rising(change.from, change.to) ? 'Lift' : 'Lower'} the ${change.scheme} ${STEP_NAMES[change.role]}${aLittle(change.from, change.to)}`
    case 'remove-override':
      return `Use the generated ${bareName(change.role)}${schemePhrase(change.scopes)}`
    case 'override-colour': {
      const step = aLittle(change.from, change.to)
      const quality =
        change.property === 'chroma'
          ? 'quieter'
          : rising(change.from, change.to)
            ? 'lighter'
            : 'darker'
      return `Make the ${bareName(change.role)}${step} ${quality}${schemePhrase(change.scopes)}`
    }
    case 'remove-status-overrides':
      return `Use the standard ${change.statuses.join(' and ')} colours`
    case 'ground-shift':
      return `${keep} ${groundPhrase(change)}`
    case 'combined':
      return change.changes
        .map((part, index) => {
          const said =
            part.kind === 'ground-shift' ? groundPhrase(part) : describeChange(part, brandColour)
          return index === 0 ? capitalise(said) : `${said.charAt(0).toLowerCase()}${said.slice(1)}`
        })
        .join(', and ')
  }
}

const round = (value: number | undefined, places: number): string =>
  value === undefined ? 'the default' : String(Number(value.toFixed(places)))

/** The same change in the theme document's own terms, for the "Details" line. */
export function describeChangeDetail(change: ThemeChange): string {
  switch (change.kind) {
    case 'accent-chroma':
      return `Accent chroma ${round(change.from, 3)} → ${round(change.to, 3)}`
    case 'tone-chroma':
      return `Neutral tint chroma ${round(change.from, 3)} → ${round(change.to, 3)}`
    case 'tone-hue':
      return `Neutral hue ${round(change.from, 0)}° → ${round(change.to, 0)}°`
    case 'accent-lightness':
      return `${capitalise(change.scheme)} accent lightness ${round(change.from, 1)} → ${round(change.to, 1)}`
    case 'neutral-step':
      return `${capitalise(change.scheme)} ${change.role} lightness ${round(change.from, 1)} → ${round(change.to, 1)}`
    case 'remove-override':
      return `Removes ${change.token} from ${change.scopes.join(' and ')}`
    case 'override-colour':
      return `${change.token} ${change.property === 'chroma' ? 'chroma' : 'lightness'} ${round(change.from, 3)} → ${round(change.to, 3)} in ${change.scopes.join(' and ')}`
    case 'remove-status-overrides':
      return `Removes the ${change.statuses.join(' and ')} status overrides`
    case 'ground-shift':
      return `${capitalise(change.scheme)} ${GROUND_NAMES.map(
        ([role, name]) =>
          `${name} lightness ${round(change.from[role], 1)} → ${round(change.from[role] + change.by, 1)}`,
      ).join(', ')}`
    case 'combined':
      return change.changes.map(describeChangeDetail).join('; ')
  }
}

/** How each status is named in the verdict and as a group heading. */
export const STATUS_COPY: Readonly<
  Record<Severity, { readonly verdict: string; readonly heading: string }>
> = {
  warn: { verdict: 'to check', heading: 'Needs a look' },
  adjusted: { verdict: 'adjusted', heading: 'Adjusted for you' },
  accepted: { verdict: 'accepted', heading: 'Accepted' },
  pass: { verdict: 'passing', heading: 'Passing' },
}

/**
 * "All 23 checks pass" when nothing needs a look, or undefined when something
 * does. An adjustment is the generator doing its job, not a finding, so it
 * counts as passing here; a warning the tenant accepted still fails its rule,
 * so it is still said.
 */
export function allClear(summary: DoctorSummary): string | undefined {
  return summary.warn > 0 || summary.accepted > 0
    ? undefined
    : `All ${summary.pass + summary.adjusted} checks pass`
}

/**
 * The verdict as one line of plain text — "3 to check, 4 adjusted, 16
 * passing" — for wherever it is read rather than seen: an
 * `aria-describedby`, a dialog description.
 */
export function describeVerdict(summary: DoctorSummary, separator = ', '): string {
  return (
    allClear(summary) ??
    severityCounts(summary)
      .map((entry) => `${entry.count} ${STATUS_COPY[entry.severity].verdict}`)
      .join(separator)
  )
}
