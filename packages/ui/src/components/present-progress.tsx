import { tv } from '../lib/class-names.ts'

/**
 * The bar's fill is drawn by the browser from `value` and `max`, so the
 * appearance lives entirely in `present.css` (the `::-webkit-progress-*` and
 * `::-moz-progress-bar` pseudo-elements a `<progress>` exposes). Nothing here
 * computes a width.
 */
export const presentProgressStyles = tv({
  base: 'present-progress pointer-events-none fixed inset-x-0 top-0 z-40 block h-1 w-full',
})

export interface PresentProgressProps {
  /** The step being presented, counted from one. */
  readonly value: number
  /** How many steps there are. */
  readonly max: number
  /** Names the bar for assistive technology. */
  readonly label?: string
  readonly className?: string | undefined
}

/**
 * How far through a presentation the room is: the one piece of chrome that is
 * never hidden (quill-plan.md section 14).
 *
 * A real `<progress>` rather than a `div` with `role="progressbar"` and a
 * computed width: the element *is* the determinate progress semantics, the
 * browser draws the fill from the two numbers, and no JavaScript arithmetic
 * ends up in a class string or a `style` prop. `aria-valuetext` says the
 * position in the words a presenter would use, because "2" alone is not what
 * a listener needs to hear.
 */
export function PresentProgress({
  value,
  max,
  label = 'Presentation progress',
  className,
}: PresentProgressProps) {
  return (
    <progress
      value={value}
      max={max}
      aria-label={label}
      aria-valuetext={`Section ${value} of ${max}`}
      className={presentProgressStyles({ className })}
    />
  )
}
