import type { VariantProps } from 'tailwind-variants'

import { tv } from '../lib/class-names.ts'

export const progressBarStyles = tv({
  slots: {
    root: 'progress-bar pointer-events-none overflow-hidden bg-transparent',
    indicator: 'progress-bar-indicator h-full w-1/3 bg-accent',
  },
  variants: {
    placement: {
      /** Pinned to the top edge of the viewport, above everything, for page-level work. */
      top: { root: 'fixed inset-x-0 top-0 z-50 h-0.5' },
      /** In flow, for a region that is loading. */
      inline: { root: 'h-0.5 w-full rounded-full bg-border' },
    },
  },
  defaultVariants: { placement: 'inline' },
})

export interface ProgressBarProps extends VariantProps<typeof progressBarStyles> {
  /** What is being waited for, announced to assistive technology. */
  readonly label: string
  readonly className?: string | undefined
}

/**
 * An indeterminate progress bar for work whose duration is unknown: a page
 * chunk still downloading, a region still fetching.
 *
 * Unlike `Spinner`, this is not decorative: it is the accessible progress
 * element itself (`role="progressbar"` without a value is the indeterminate
 * form), so it carries the label. Under reduced motion the sweep stops and
 * the bar shows as a steady full line, which still says "busy" without
 * moving (`docs/design/feedback.md`).
 */
export function ProgressBar({ label, placement, className }: ProgressBarProps) {
  const styles = progressBarStyles({ placement })
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy="true"
      className={styles.root({ className })}
    >
      <div className={styles.indicator()} />
    </div>
  )
}
