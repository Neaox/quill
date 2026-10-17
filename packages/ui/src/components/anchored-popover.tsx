import { useMemo, type ReactNode } from 'react'
import { Popover as Primitive } from 'radix-ui'

import { tv } from '../lib/class-names.ts'

/**
 * A small panel held against a place on the screen rather than a trigger:
 * the words a link is being made of, a picture whose description is being
 * written. It is not a dialog — nothing behind it is locked — so Escape and a
 * press elsewhere close it, and focus goes back to where the person was,
 * which the caller says, because the place it hangs from is not a control.
 */

export const anchoredPopoverStyles = tv({
  slots: {
    panel: [
      'menu-panel z-50 flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-lg border',
      'border-border bg-surface-raised p-3 text-sm text-foreground shadow-overlay',
    ],
  },
})

/** A box in the viewport's pixels. */
export interface PopoverAnchor {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface AnchoredPopoverProps {
  readonly open: boolean
  readonly anchor: PopoverAnchor
  /** Names the panel for assistive technology. */
  readonly label: string
  readonly children: ReactNode
  readonly side?: 'top' | 'bottom'
  /**
   * Which edge of the box the panel lines up with: `end` for a box at the end
   * of a block, so the panel opens back over the block rather than out past
   * it. Collision handling keeps it on screen either way.
   */
  readonly align?: 'start' | 'end'
  /**
   * The region the panel is kept inside as well as the screen: the page's
   * main region, say, so it never opens over the sidebar beside it.
   */
  readonly boundary?: Element | null | undefined
  readonly className?: string | undefined
  onOpenChange(open: boolean): void
  /** Where focus goes when the panel closes. */
  onCloseFocus?(): void
}

export function AnchoredPopover({
  open,
  anchor,
  label,
  children,
  side = 'bottom',
  align = 'start',
  boundary,
  className,
  onOpenChange,
  onCloseFocus,
}: AnchoredPopoverProps) {
  const styles = anchoredPopoverStyles()
  // Radix measures a virtual element: the box, as a DOMRect would give it.
  const virtual = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          DOMRect.fromRect({
            x: anchor.x,
            y: anchor.y,
            width: anchor.width,
            height: anchor.height,
          }),
      },
    }),
    [anchor.x, anchor.y, anchor.width, anchor.height],
  )

  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Anchor virtualRef={virtual} />
      <Primitive.Portal>
        <Primitive.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          collisionBoundary={boundary ?? []}
          className={styles.panel({ className })}
          onEscapeKeyDown={(event) => {
            // A control inside with a list open — a combobox — closes that first.
            if (document.activeElement?.getAttribute('aria-expanded') === 'true') {
              event.preventDefault()
            }
          }}
          onCloseAutoFocus={(event) => {
            if (onCloseFocus === undefined) return
            event.preventDefault()
            onCloseFocus()
          }}
        >
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
