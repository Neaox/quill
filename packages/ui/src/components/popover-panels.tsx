import { useRef, type ReactNode, type RefObject } from 'react'
import { Popover } from 'radix-ui'

/**
 * A popover's Radix half — dismissal, focus handling, collision-aware
 * placement — fetched on demand by whatever draws the closed trigger
 * (`revision-timeline.tsx`), since a closed popover needs none of it.
 *
 * It never draws the trigger. The caller's light button stays the trigger for
 * the popover's whole life and owns the open state; this hangs the panel from
 * an inert box laid inside it (`Popover.Anchor`), returns focus to it on
 * close, and does not treat a press on it as a press outside — the button's
 * own click closes the popover. So arriving never replaces the element a
 * pointer or a key was on.
 */
export interface RadixPopoverProps {
  /** Names the panel for assistive technology. */
  readonly label: string
  readonly className: string
  /** The inert box's class: the trigger's own bounds. */
  readonly anchorClassName: string
  readonly children: ReactNode
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The light trigger the panel belongs to. */
  readonly trigger: RefObject<HTMLButtonElement | null>
  readonly contentId: string
}

export function RadixPopover({
  label,
  className,
  anchorClassName,
  children,
  open,
  onOpenChange,
  trigger,
  contentId,
}: RadixPopoverProps) {
  const pressedElsewhere = useRef(false)

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <span aria-hidden="true" className={anchorClassName} />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={contentId}
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className={className}
          onInteractOutside={(event) => {
            const target = event.target
            if (target instanceof Node && trigger.current?.contains(target) === true) {
              event.preventDefault()
              return
            }
            pressedElsewhere.current = true
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (!pressedElsewhere.current) trigger.current?.focus()
            pressedElsewhere.current = false
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
