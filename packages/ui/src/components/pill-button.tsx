import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'
import { PlusIcon } from './icons.tsx'

/**
 * A small suggestion you can act on: a plus, a label, and a quiet detail (a
 * count). It is the counterpart of `FilterChip`, which is a filter already
 * applied and has a way to take it off; this is one that is not yet applied,
 * and it is drawn plain and outlined with a plus so the two cannot be mistaken
 * for each other by anything but colour.
 *
 * Put them in a list, as chips are. At least 24px to aim at (WCAG 2.5.8) and
 * 44px on a coarse pointer; a long label truncates rather than widening the
 * row.
 */
export const pillButtonStyles = tv({
  slots: {
    root: [
      'inline-flex h-6 max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-full border',
      'border-border bg-transparent ps-2 pe-2.5 text-xs text-foreground',
      'transition-colors ease-standard hover:border-border-strong hover:bg-surface',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:pointer-events-none disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:px-3',
    ],
    icon: 'size-3 text-muted',
    label: 'truncate',
    detail: 'shrink-0 text-muted tabular-nums',
  },
})

export interface PillButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'type'> {
  readonly children: ReactNode
  /** Quiet text after the label: a count. Give the button an `aria-label` that says what it means. */
  readonly detail?: ReactNode
}

export function PillButton({ children, detail, className, ...rest }: PillButtonProps) {
  const styles = pillButtonStyles()
  return (
    // `type="button"`: a pill often sits inside a form it must not submit.
    <button type="button" {...rest} className={styles.root({ className })}>
      <PlusIcon className={styles.icon()} />
      <span className={styles.label()}>{children}</span>
      {detail === undefined ? undefined : <span className={styles.detail()}>{detail}</span>}
    </button>
  )
}
