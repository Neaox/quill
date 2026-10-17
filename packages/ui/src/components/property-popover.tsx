import { useState, type ReactElement, type ReactNode } from 'react'
import { Popover as Primitive } from 'radix-ui'

import { tv } from '../lib/class-names.ts'

/**
 * A small panel that edits one value, opened from that value.
 *
 * The properties line is a row of facts that are also their own controls
 * (`docs/design/properties.md`): press an owner, a tag, a date, and its
 * editor opens against it. Not a dialog — nothing behind it is locked — so
 * Escape and a press elsewhere close it, and focus goes back to the value it
 * came from, which is the primitive's. On a phone it is as wide as the screen
 * allows and kept inside it by collision handling, so it is never off-screen.
 *
 * `AnchoredPopover` is the same panel for a place that is not a control (a
 * selection in the editor); this one has a real trigger, which is what gives
 * it `aria-expanded` and focus return for free.
 */

export const propertyPopoverStyles = tv({
  slots: {
    panel: [
      'menu-panel z-50 flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-lg border',
      'border-border bg-surface-raised p-3 text-sm text-foreground shadow-overlay',
    ],
  },
})

export interface PropertyPopoverProps {
  /** Names the panel for assistive technology: "Edit owners". */
  readonly label: string
  /** The value it edits, as a `button`; it becomes the panel's trigger. */
  readonly trigger: ReactElement
  /** The editor. A function is given `close`, for an editor that finishes on its own. */
  readonly children: ReactNode | ((close: () => void) => ReactNode)
  readonly open?: boolean | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
  readonly align?: 'start' | 'center' | 'end'
  readonly className?: string | undefined
}

export function PropertyPopover({
  label,
  trigger,
  children,
  open: controlled,
  onOpenChange,
  align = 'start',
  className,
}: PropertyPopoverProps) {
  const [uncontrolled, setUncontrolled] = useState(false)
  const open = controlled ?? uncontrolled
  const styles = propertyPopoverStyles()

  function change(next: boolean): void {
    setUncontrolled(next)
    onOpenChange?.(next)
  }

  return (
    <Primitive.Root open={open} onOpenChange={change}>
      <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          aria-label={label}
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={styles.panel({ className })}
        >
          {typeof children === 'function'
            ? children(() => {
                change(false)
              })
            : children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
