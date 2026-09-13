import { tv } from '../lib/class-names.ts'

export const spinnerStyles = tv({
  base: 'size-[1em] shrink-0 animate-spin [animation-duration:700ms]',
})

export interface SpinnerProps {
  /** Extra classes, appended last. */
  readonly className?: string | undefined
}

/**
 * An indeterminate progress indicator.
 *
 * Decorative by itself: the component that shows it is responsible for saying
 * what is busy, with `aria-busy` or a live region. Its animation is built from
 * the motion tokens, so reduced motion stops it.
 */
export function Spinner({ className }: SpinnerProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className={spinnerStyles({ className })}
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  )
}
