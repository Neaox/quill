import { cnMerge, createTV, type ClassValue, type TWMergeConfig } from 'tailwind-variants'

export type { ClassValue }

/**
 * The design system's own utilities, taught to tailwind-merge once.
 *
 * Merging only works if two classes are known to belong to the same group, and
 * tailwind-merge cannot know about a scale we invented. Without this,
 * `text-reading` and `text-sm` would both survive and stylesheet order would
 * decide which won — exactly the unpredictability the merge exists to remove.
 * Colour utilities need no entry: `bg-surface-raised` and `text-muted` are
 * ordinary `bg-*` and `text-*` values.
 */
const twMergeConfig: TWMergeConfig = {
  extend: {
    classGroups: {
      'font-size': [{ text: ['2xs', 'reading'] }],
      'font-family': [{ font: ['display', 'reading'] }],
      tracking: [{ tracking: ['caps'] }],
      shadow: [{ shadow: ['raised', 'overlay', 'dialog'] }],
      ease: [{ ease: ['standard', 'emphasised', 'exit'] }],
    },
  },
}

/**
 * `tv`, configured with the utilities above.
 *
 * Every component in this package declares its design variation with this,
 * and its interaction states as Tailwind variants on real attributes inside
 * `base` or a slot (`docs/architecture/styling.md`). Components import it from
 * here rather than from the library, so the configuration cannot be forgotten
 * in one file and applied in the rest.
 */
export const tv = createTV({ twMergeConfig })

/**
 * Joins class names, resolving Tailwind conflicts in favour of the last one.
 *
 * A primitive owns its base classes and accepts a `className` appended last,
 * so a caller's `p-0` beats the component's `p-4` predictably rather than by
 * whichever rule the compiled stylesheet happens to emit second. That is a
 * convenience for layout and spacing, not an invitation: the supported way to
 * change how a component looks is a variant.
 */
export function cx(...values: readonly ClassValue[]): string {
  // `cnMerge` returns undefined when nothing survives; a component's
  // `className` is always a string, never a missing attribute.
  return cnMerge(...values)({ twMergeConfig }) ?? ''
}
