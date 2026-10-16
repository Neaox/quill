import type { ReactNode } from 'react'
import { Popover as Primitive } from 'radix-ui'

import { tv } from '../lib/class-names.ts'

export const popoverStyles = tv({
  slots: {
    trigger: [
      'relative inline-flex h-8 min-w-8 items-center justify-center rounded-md text-muted',
      'transition-colors ease-standard hover:bg-surface hover:text-foreground',
      'data-[state=open]:bg-surface data-[state=open]:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    panel: [
      'z-50 flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-96',
      'max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border',
      'bg-surface-raised text-foreground shadow-overlay',
    ],
  },
})

export interface PopoverProps {
  /** The button's name, which is what it opens: "Notifications". */
  readonly label: string
  /** The panel's name, read when it opens. */
  readonly title: string
  /** What the button shows: an icon, usually, with whatever badge it carries. */
  readonly trigger: ReactNode
  readonly children: ReactNode
  readonly align?: 'start' | 'center' | 'end'
  /** Told when it opens and closes, for a caller that keeps something in step with it. */
  readonly onOpenChange?: ((open: boolean) => void) | undefined
  readonly className?: string | undefined
}

/**
 * A panel that hangs from a button, for something richer than a menu and lighter than a
 * dialog: a short list somebody glances at and leaves. It does not take the page from them
 * (no overlay, no focus trap beyond keeping Tab inside until it closes), and Escape or a click
 * elsewhere closes it with focus back on the button, which is the primitive's.
 */
export function Popover({
  label,
  title,
  trigger,
  children,
  align = 'end',
  onOpenChange,
  className,
}: PopoverProps) {
  const styles = popoverStyles()

  return (
    <Primitive.Root {...(onOpenChange === undefined ? {} : { onOpenChange })}>
      <Primitive.Trigger className={styles.trigger({ className })} aria-label={label}>
        {trigger}
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          align={align}
          sideOffset={8}
          collisionPadding={16}
          aria-label={title}
          className={styles.panel()}
        >
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
