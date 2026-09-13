import type { ReactNode } from 'react'
import { Tooltip as Primitive } from 'radix-ui'

import { tv } from '../lib/class-names.ts'

/**
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
  },
})

export interface TooltipProviderProps {
  readonly children: ReactNode
  /** Milliseconds of hover before the first tooltip in a group appears. */
  readonly delayDuration?: number
}

/**
 * Shares hover timing between tooltips, so moving along a toolbar does not
 * replay the delay for every control. Mount it once, near the root.
 */
export function TooltipProvider({ children, delayDuration = 300 }: TooltipProviderProps) {
  return (
    <Primitive.Provider delayDuration={delayDuration} skipDelayDuration={200}>
      {children}
    </Primitive.Provider>
  )
}

export interface TooltipProps {
  /** The tip itself. Supplementary, never the only place information lives. */
  readonly content: ReactNode
  /** The control being described. Must be focusable to be reachable. */
  readonly children: ReactNode
  readonly side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * A short hint attached to a control.
 *
 * Shown on hover and on keyboard focus, dismissed by Escape, and exposed as
 * the trigger's description rather than its name, so an icon button still
 * needs its own `aria-label`. A tooltip is never the only route to the
 * information it carries.
 */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const styles = tooltipStyles()

  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={styles.panel()}
        >
          {content}
          <Primitive.Arrow className={styles.arrow()} width={10} height={5} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
