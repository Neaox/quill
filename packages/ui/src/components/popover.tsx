import { useId, useRef, useState, type ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'
import { onDemand, useOnDemandWhen } from '../lib/on-demand.ts'

export const popoverStyles = tv({
  slots: {
    trigger: [
      'relative inline-flex h-8 min-w-8 items-center justify-center rounded-md text-muted',
      'transition-colors ease-standard hover:bg-surface hover:text-foreground',
      'data-[state=open]:bg-surface data-[state=open]:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    /** The inert box the panel hangs from: the trigger's own bounds. */
    anchor: 'pointer-events-none absolute inset-0',
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
 * The panel's machinery (dismissal, focus, collision-aware placement), fetched on demand
 * (quill-plan.md section 31; `lib/on-demand.ts`): the bell sits in every signed-in header, so
 * Radix in its first render would be in every page's first load.
 */
const popovers = onDemand(() => import('./popover-panels.tsx'))

/**
 * A panel that hangs from a button, for something richer than a menu and lighter than a
 * dialog: a short list somebody glances at and leaves. It does not take the page from them
 * (no overlay, no focus trap beyond keeping Tab inside until it closes), and Escape or a click
 * elsewhere closes it with focus back on the button.
 *
 * The button is always this component's own, drawn without the machinery, so a press that lands
 * before the machinery arrives is held on the element that stays the trigger once it has.
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
  const [open, setOpenState] = useState(false)
  const loaded = useOnDemandWhen(popovers, open)
  const button = useRef<HTMLButtonElement>(null)
  const contentId = useId()
  const shown = open && loaded !== undefined

  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  const preload = () => {
    void popovers.load().catch(() => undefined)
  }

  return (
    <button
      ref={button}
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={shown}
      {...(shown ? { 'aria-controls': contentId } : {})}
      aria-busy={open && loaded === undefined ? true : undefined}
      data-state={shown ? 'open' : 'closed'}
      className={styles.trigger({ className })}
      onPointerEnter={preload}
      onFocus={preload}
      onClick={(event) => {
        // The panel is a React child in a portal: its clicks bubble here.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
        setOpen(!open)
      }}
    >
      {trigger}
      {loaded === undefined ? undefined : (
        <loaded.RadixPopover
          label={title}
          className={styles.panel()}
          anchorClassName={styles.anchor()}
          open={open}
          onOpenChange={setOpen}
          trigger={button}
          contentId={contentId}
          align={align}
          sideOffset={8}
          collisionPadding={16}
        >
          {children}
        </loaded.RadixPopover>
      )}
    </button>
  )
}
