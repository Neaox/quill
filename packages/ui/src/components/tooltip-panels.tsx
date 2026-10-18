import { useCallback, type ReactNode, type RefObject } from 'react'
import { Tooltip as Primitive } from 'radix-ui'

import { tooltipStyles } from './tooltip-model.ts'

/**
 * The tooltip's Radix half — collision-aware placement, the portal, Escape —
 * fetched on demand (`tooltip.tsx`), since a tip that is not showing needs
 * none of it.
 *
 * It never draws the control it describes. `tooltip.tsx` keeps the caller's
 * own element as the trigger for good, owns when the tip opens (hover intent,
 * focus, the group's warm-up), and points the element's `aria-describedby` at
 * the content here; this positions the content against that element through
 * an inert stand-in that measures as the element does. So the module arriving
 * — or this half mounting on the first hover — never replaces the node under
 * the pointer, and a click that follows at once lands on it.
 */
export function RadixTooltip({
  content,
  side = 'top',
  open,
  onOpenChange,
  anchor,
  id,
}: {
  readonly content: ReactNode
  readonly side?: 'top' | 'right' | 'bottom' | 'left' | undefined
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The control the tip describes. */
  readonly anchor: RefObject<HTMLElement | null>
  /** The content's id, which the control's `aria-describedby` names. */
  readonly id: string
}) {
  const styles = tooltipStyles()

  // The primitive positions against its trigger's bounding box; the stand-in
  // answers with the real control's, wherever transforms or scrolling put it.
  const standIn = useCallback(
    (element: HTMLSpanElement | null) => {
      if (element === null) return
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => anchor.current?.getBoundingClientRect() ?? new DOMRect(),
      })
    },
    [anchor],
  )

  return (
    <Primitive.Provider delayDuration={0} skipDelayDuration={0}>
      <Primitive.Root open={open} onOpenChange={onOpenChange}>
        <Primitive.Trigger asChild>
          <span ref={standIn} aria-hidden="true" className={styles.standIn()} />
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            id={id}
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
    </Primitive.Provider>
  )
}
