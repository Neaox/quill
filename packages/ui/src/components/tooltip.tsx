import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { Slot } from 'radix-ui'

import { onDemand, useOnDemandWhen } from '../lib/on-demand.ts'
import { createTooltipTiming, type TooltipProps, type TooltipTiming } from './tooltip-model.ts'

export { tooltipStyles, type TooltipProps } from './tooltip-model.ts'

/** How long a group stays warm after a tip closes. */
const SKIP_DELAY_MS = 200

const TimingContext = createContext<TooltipTiming>(createTooltipTiming(300, SKIP_DELAY_MS))

export interface TooltipProviderProps {
  readonly children: ReactNode
  /** Milliseconds of hover before the first tooltip in a group appears. */
  readonly delayDuration?: number
}

/**
 * Shares hover timing between tooltips, so moving along a toolbar does not
 * replay the delay for every control. Mount it once, near the root.
 *
 * Our own context rather than the primitive's provider: the provider would
 * bring the whole primitive with it into every page that mounts one, and the
 * primitive is the tooltips' on-demand half.
 */
export function TooltipProvider({ children, delayDuration = 300 }: TooltipProviderProps) {
  const timing = useMemo(() => createTooltipTiming(delayDuration, SKIP_DELAY_MS), [delayDuration])
  return <TimingContext value={timing}>{children}</TimingContext>
}

/**
 * The tooltip's machinery — floating positioning, dismissal, presence —
 * fetched on demand (quill-plan.md section 31; `lib/on-demand.ts`): in idle
 * time, or at once when the control is pointed at or focused, and mounted
 * only for that control.
 */
const panels = onDemand(() => import('./tooltip-panels.tsx'))

/** Fetches the tooltip's machinery now; safe to call repeatedly. */
export function preloadTooltips(): Promise<unknown> {
  return panels.load()
}

/**
 * A short hint attached to a control.
 *
 * Shown on hover and on keyboard focus, dismissed by Escape, and exposed as
 * the trigger's description rather than its name, so an icon button still
 * needs its own `aria-label`. A tooltip is never the only route to the
 * information it carries — which is also why the control is drawn on its own
 * until the machinery arrives.
 *
 * The control is the caller's element and stays that element: this owns when
 * the tip opens (the pointer resting on it for the group's delay, or focus
 * that a press did not cause) and the machinery only draws the tip beside it
 * (`tooltip-panels.tsx`). It is fetched in idle time and mounted for this
 * control the first time the tip is wanted (`useOnDemandWhen`) — never for
 * every hinted control at once, and never by replacing the element under the
 * pointer, so a click that follows a hover always lands.
 */
export function Tooltip({ content, children, side }: TooltipProps) {
  const timing = useContext(TimingContext)
  const [open, setOpen] = useState(false)
  const loaded = useOnDemandWhen(panels, open)
  const control = useRef<HTMLElement>(null)
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pressing = useRef(false)
  const contentId = useId()

  // The pending open is a timer — an external system — cleared on unmount.
  useEffect(
    () => () => {
      clearTimeout(delay.current)
    },
    [],
  )

  const preload = () => {
    void panels.load().catch(() => undefined)
  }
  const show = () => {
    clearTimeout(delay.current)
    if (open) return
    setOpen(true)
    timing.opened()
  }
  const hide = () => {
    clearTimeout(delay.current)
    if (!open) return
    setOpen(false)
    timing.closed()
  }
  const shown = open && loaded !== undefined

  return (
    <>
      <Slot.Root
        ref={control}
        {...(shown ? { 'aria-describedby': contentId } : {})}
        data-state={shown ? 'delayed-open' : 'closed'}
        onPointerEnter={(event: PointerEvent) => {
          if (event.pointerType === 'touch') return
          preload()
          clearTimeout(delay.current)
          if (timing.isWarm()) show()
          else delay.current = setTimeout(show, timing.delayDuration)
        }}
        onPointerLeave={hide}
        onPointerDown={() => {
          pressing.current = true
          hide()
        }}
        onPointerUp={() => {
          pressing.current = false
        }}
        onFocus={() => {
          preload()
          // Focus a press caused is the press's, not a request for the tip.
          if (!pressing.current) show()
        }}
        onBlur={hide}
        onClick={hide}
      >
        {children}
      </Slot.Root>
      {loaded === undefined ? undefined : (
        <loaded.RadixTooltip
          content={content}
          side={side}
          open={open}
          onOpenChange={(next) => {
            /* v8 ignore else -- opening is this component's; Radix's trigger is an inert stand-in (no pointer events, not focusable), so it only ever asks to close. */
            if (!next) hide()
          }}
          anchor={control}
          id={contentId}
        />
      )}
    </>
  )
}
