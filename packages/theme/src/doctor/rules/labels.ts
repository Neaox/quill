import type { Palette } from '../../colour/palette.ts'
import { CONTRAST_FLOORS } from '../../contrast/floors.ts'
import { isReservedLabelName } from '../../schema/labels.ts'
import { describe, holds, type Pair } from '../pairs.ts'
import { check, fromChecks, type Rule } from '../rule.ts'

/** Every pair a label is drawn in: its words on the page and on its own pill, its lines in a drawing. */
const labelPairs = (palette: Palette): readonly Pair[] => {
  const { paper, surface, raised } = palette.colours
  return palette.labels.flatMap((label) => [
    ...Object.entries({ paper, surface, raised, 'its fill': label.fill }).map(
      ([name, background]): Pair => ({
        label: `${palette.scheme} label ${label.name} on ${name}`,
        foreground: label.ink,
        background,
        floor: CONTRAST_FLOORS.secondary,
      }),
    ),
    {
      label: `${palette.scheme} label ${label.name} stroke on raised`,
      foreground: label.stroke,
      background: raised,
      floor: CONTRAST_FLOORS.nonText,
    },
  ])
}

/**
 * ADR-037: a tenant's labels are settled against the same floors as the
 * status tones, so a label's words read on every surface and on its own
 * pill, and its lines show on a drawing. A stored label whose name a newer
 * release made a built-in is shadowed by the built-in until it is renamed,
 * which is said here rather than left to be discovered.
 */
export const labelRule: Rule = {
  id: 'legibility/labels',
  section: 1,
  title: 'Labels are readable in both schemes and shadow no built-in',
  // A theme without labels has nothing here to pass, so it is not counted.
  appliesTo: (theme) => (theme.labels ?? []).length > 0,
  evaluate: (_theme, palettes) =>
    fromChecks(
      [
        ...[...labelPairs(palettes.light), ...labelPairs(palettes.dark)].map((pair) =>
          check(describe(pair), holds(pair)),
        ),
        ...palettes.light.labels.map((label) =>
          check(
            `the label ${label.name} is shadowed by a built-in name; rename it`,
            !isReservedLabelName(label.name),
          ),
        ),
      ],
      'every label clears its floors in both schemes',
    ),
}
