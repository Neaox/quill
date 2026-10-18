import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'
import { CloseIcon } from './icons.tsx'

/**
 * A filter on a search, shown as what it is and a way to take it off.
 *
 * `data-negated` is the one state, a real attribute the style reads
 * (`docs/architecture/styling.md`); it only ever adds emphasis, because the
 * words already say it ("Not by: ada") and a dashed edge is no way to tell
 * someone a filter is inverted.
 */
export const filterChipStyles = tv({
  slots: {
    root: [
      'inline-flex max-w-full items-center rounded-full border border-border bg-surface-raised',
      'ps-3 pe-1 text-xs text-foreground data-[negated=true]:border-dashed',
    ],
    text: 'truncate py-1',
    remove: [
      // At least 24px to aim at (WCAG 2.5.8), and the 44px touch size on a coarse pointer.
      'ms-1 inline-grid size-6 shrink-0 place-items-center rounded-full text-muted',
      'transition-colors ease-standard hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
      'pointer-coarse:size-11',
      '[&_svg]:size-3.5',
    ],
  },
})

export interface FilterChipProps {
  /** The filter read as a phrase: "By: ada", "Not tag: old". */
  readonly children: ReactNode
  /** The filter is one that leaves documents out. */
  readonly negated?: boolean | undefined
  /** The remove button's accessible name, which has to say which filter it removes. */
  readonly removeLabel: string
  readonly onRemove: () => void
  readonly className?: string | undefined
}

/**
 * One filter chip. Put them in a list: a row of chips is a list of things,
 * and the list is what tells a screen reader how many there are.
 */
export function FilterChip({
  children,
  negated = false,
  removeLabel,
  onRemove,
  className,
}: FilterChipProps) {
  const styles = filterChipStyles()
  return (
    <span data-negated={negated} className={styles.root({ className })}>
      <span className={styles.text()}>{children}</span>
      {/* `type="button"`: a chip sits inside the search form, and taking one
          off is not submitting it. */}
      <button type="button" aria-label={removeLabel} onClick={onRemove} className={styles.remove()}>
        <CloseIcon />
      </button>
    </span>
  )
}
