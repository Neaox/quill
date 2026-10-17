import type { LabelColours } from './colour/labels.ts'
import { formatOklch } from './colour/oklch.ts'
import type { Scheme } from './colour/bands.ts'

/**
 * A tenant label as CSS (ADR-037, "The theme stylesheet colours them").
 *
 * Each label is three custom properties per scheme, declared beside the
 * theme's own tokens so they follow light and dark exactly as the palette
 * does, and a handful of rules that read them: a `.badge` carrying the
 * label's `data-label` sets its dot in the label's stroke (the pill stays
 * neutral, so its words keep body contrast; `prose.css` draws the dot,
 * the way channel tags are commonly drawn), and inside an inline drawing
 * the class of the same name colours shapes, lines and text. One name, so a
 * channel's pill in a table and its arrow in a diagram are one colour.
 *
 * Names reach selectors and property names unescaped. That is safe because a
 * theme's labels are validated against `LABEL_NAME_PATTERN` before a theme is
 * accepted, and the pattern admits nothing CSS gives a meaning to; the check
 * below is the last line, so a name that somehow skipped validation is left
 * out rather than written.
 */

export type LabelTokens = {
  readonly ink: string
  readonly fill: string
  readonly stroke: string
}

export type GeneratedLabel = {
  readonly name: string
  readonly title: string
  readonly light: LabelTokens
  readonly dark: LabelTokens
}

const SAFE_NAME = /^[a-z][a-z0-9-]{0,31}$/u

export const labelTokens = (colours: LabelColours): LabelTokens => ({
  ink: formatOklch(colours.ink),
  fill: formatOklch(colours.fill),
  stroke: formatOklch(colours.stroke),
})

/** The custom property one of a label's colours is declared as. */
export const labelProperty = (name: string, role: keyof LabelTokens): string =>
  `--label-${name}-${role}`

const safe = (labels: readonly GeneratedLabel[]): readonly GeneratedLabel[] =>
  labels.filter((label) => SAFE_NAME.test(label.name))

/** The declarations a scheme's block carries for every label, one per line. */
export const labelDeclarations = (
  labels: readonly GeneratedLabel[],
  scheme: Scheme,
  indent: string,
): string =>
  safe(labels)
    .flatMap((label) =>
      (['ink', 'fill', 'stroke'] as const).map(
        (role) => `${indent}${labelProperty(label.name, role)}: ${label[scheme][role]};`,
      ),
    )
    .join('\n')

const DRAWING = ".diagram[data-diagram='svg']"

/** The rules that read a label's properties, scoped to the theme's selector. */
const rulesFor = (scope: string, name: string): string => {
  const ink = `var(${labelProperty(name, 'ink')})`
  const fill = `var(${labelProperty(name, 'fill')})`
  const stroke = `var(${labelProperty(name, 'stroke')})`
  const labelled = `:is(.${name}, .${name} *)`
  const inDrawing = `${scope} ${DRAWING}`
  return [
    `${scope} .badge[data-label='${name}'] {`,
    `  --label-dot: ${stroke};`,
    '}',
    '',
    `${inDrawing} ${labelled}:is(rect, circle, ellipse, polygon) {`,
    `  fill: ${fill};`,
    `  stroke: ${stroke};`,
    '}',
    '',
    `${inDrawing} ${labelled}:is(path, line, polyline) {`,
    `  stroke: ${stroke};`,
    '}',
    '',
    `${inDrawing} marker ${labelled}:is(path, polygon) {`,
    `  fill: ${stroke};`,
    '}',
    '',
    `${inDrawing} ${labelled}:is(text, tspan) {`,
    `  fill: ${ink};`,
    '}',
  ].join('\n')
}

/** Every label's rules, or the empty string for a theme without labels. */
export const labelRules = (labels: readonly GeneratedLabel[], scope: string): string =>
  safe(labels)
    .map((label) => rulesFor(scope, label.name))
    .join('\n\n')
