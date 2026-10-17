import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'

/**
 * How a tooltip looks and what it is given, shared by the tooltip every page
 * draws (`tooltip.tsx`) and the Radix machinery that shows it, which arrives
 * on demand (`tooltip-panels.tsx`).
 *
 * The entrance animation lives with the keyframes in `tokens.css`, keyed on
 * the primitive's own `data-state`, so it is stated once and reduced motion
 * neutralises it there.
 */
export const tooltipStyles = tv({
  slots: {
    panel: [
      'tooltip-panel z-50 max-w-64 rounded-md border border-border bg-surface-raised',
      'px-2.5 py-1.5 text-2xs leading-snug text-foreground shadow-overlay',
    ],
    arrow: 'fill-surface-raised',
    /** The inert, sizeless box the primitive measures; it reports the control's bounds (`tooltip-panels.tsx`). */
    standIn: 'pointer-events-none absolute size-0 overflow-hidden',
  },
})

export interface TooltipProps {
  /** The tip itself. Supplementary, never the only place information lives. */
  readonly content: ReactNode
  /** The control being described. Must be focusable to be reachable. */
  readonly children: ReactNode
  readonly side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * When tooltips in one group appear: the first after a pause, and the next
 * straight away while the group is still warm — moving along a toolbar does
 * not replay the delay for every control. Shared by the group's tooltips
 * through `TooltipProvider`, and kept here rather than in the primitive's own
 * provider so that the provider costs a page nothing (`tooltip.tsx`).
 */
export interface TooltipTiming {
  /** Milliseconds of hover before a tip appears in a cold group. */
  readonly delayDuration: number
  /** Whether a tip is showing, or closed within the last `skipDelayDuration`. */
  readonly isWarm: () => boolean
  readonly opened: () => void
  readonly closed: () => void
}

export function createTooltipTiming(
  delayDuration: number,
  skipDelayDuration: number,
  now: () => number = () => performance.now(),
): TooltipTiming {
  let showing = 0
  let warmUntil = Number.NEGATIVE_INFINITY
  return {
    delayDuration,
    isWarm: () => showing > 0 || now() < warmUntil,
    opened: () => {
      showing += 1
    },
    closed: () => {
      showing = Math.max(0, showing - 1)
      warmUntil = now() + skipDelayDuration
    },
  }
}
