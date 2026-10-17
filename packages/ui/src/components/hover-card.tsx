import type { ReactNode } from 'react'
import { HoverCard as Primitive } from 'radix-ui'

import { tv } from '../lib/class-names.ts'

export const hoverCardStyles = tv({
  slots: {
    panel: [
      'menu-panel z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-border',
      'bg-surface-raised p-4 text-xs leading-relaxed text-body shadow-overlay',
    ],
    title: 'text-sm font-medium text-foreground',
    arrow: 'fill-surface-raised',
  },
})

export interface HoverCardProps {
  /** The panel's heading. */
  readonly title: string
  /** What the panel says. */
  readonly content: ReactNode
  /** The control it explains, which stays exactly what it was. */
  readonly children: ReactNode
  /** Where the panel hangs from the control. */
  readonly side?: 'top' | 'bottom' | 'left' | 'right'
  readonly align?: 'start' | 'center' | 'end'
}

/**
 * A panel that explains a control while the pointer rests on it, or focus is on it.
 *
 * It is for what is worth knowing before pressing: what a button is about to do. It
 * is for the eye, and says nothing a person without one could not find out another
 * way, because a hover card is not announced; whatever it says must also be the
 * control's description (`aria-describedby`), which is the caller's to provide. It
 * holds nothing that can be pressed, which is what an `InfoPopover` is for, and
 * it goes with the pointer or with Escape.
 */
export function HoverCard({
  title,
  content,
  children,
  side = 'bottom',
  align = 'end',
}: HoverCardProps) {
  const styles = hoverCardStyles()
  return (
    <Primitive.Root openDelay={250} closeDelay={150}>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={16}
          className={styles.panel()}
        >
          <p className={styles.title()}>{title}</p>
          <div>{content}</div>
          <Primitive.Arrow className={styles.arrow()} width={12} height={6} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
