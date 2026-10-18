import {
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type RefObject,
  type SyntheticEvent,
} from 'react'

import { onDemand, useOnDemandWhen } from '../lib/on-demand.ts'
import { buttonClassName } from './button.tsx'
import {
  menuStyles,
  type MenuAnchorProps,
  type MenuButtonProps,
  type MenuOpening,
  type MenuProps,
} from './menu-model.ts'

export {
  menuStyles,
  type MenuButtonProps,
  type MenuEntry,
  type MenuItem,
  type MenuProps,
  type MenuSection,
} from './menu-model.ts'

/**
 * The menus' Radix machinery — roving focus, type-ahead, dismissal, floating
 * positioning — is most of what a menu weighs and draws nothing until one is
 * opened, so it is not in the graph a page needs for its first paint
 * (quill-plan.md section 31).
 *
 * The trigger is always the light one drawn here, and the machinery never
 * replaces it: once a trigger is pressed, the panel is attached *to that
 * element* (`menu-panels.tsx`), so the node a pointer is over, a key was
 * pressed on, or a screen reader is sitting on is the same node before and
 * after. Only the pressed trigger takes the machinery on
 * (`useOnDemandWhen`); every other one stays light for good, because a tree
 * with a menu on each of twenty thousand rows must not mount twenty thousand
 * Radix menus because the module happened to arrive (2026-10-17). The module
 * is fetched in idle time, or at once on hover or focus; a press that lands
 * before it is held, and the menu opens as soon as it can, onto its first item
 * when the press was a key.
 */
const panels = onDemand(() => import('./menu-panels.tsx'))

/** Fetches the menus' machinery now; safe to call repeatedly. */
export function preloadMenus(): Promise<unknown> {
  return panels.load()
}

/**
 * An event that happened on the trigger itself. The panel is a React child of
 * the trigger (in a portal), so its clicks and keys bubble here through React
 * even though they are nowhere near it in the DOM.
 */
function onTrigger(event: SyntheticEvent<HTMLButtonElement>): boolean {
  return event.target instanceof Node && event.currentTarget.contains(event.target)
}

/** The trigger's state and handlers, shared by both kinds of menu. */
function useMenuTrigger() {
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState<MenuOpening | undefined>(undefined)
  const loaded = useOnDemandWhen(panels, opening !== undefined)
  const trigger = useRef<HTMLButtonElement>(null)
  const triggerId = useId()
  const contentId = useId()
  const preload = () => {
    void panels.load().catch(() => undefined)
  }
  const ask = (how: MenuOpening) => {
    setOpening(how)
    setOpen(true)
  }
  const shown = open && loaded !== undefined

  const triggerProps: ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly ref: RefObject<HTMLButtonElement | null>
    readonly 'data-state': 'open' | 'closed'
  } = {
    ref: trigger,
    id: triggerId,
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': shown,
    ...(shown ? { 'aria-controls': contentId } : {}),
    // A press waiting for the machinery says so.
    'aria-busy': open && loaded === undefined ? true : undefined,
    'data-state': shown ? 'open' : 'closed',
    onPointerEnter: preload,
    onFocus: preload,
    // `detail` is zero for a click the keyboard made (Enter, Space).
    onClick: (event) => {
      if (!onTrigger(event)) return
      if (open) setOpen(false)
      else ask(event.detail === 0 ? 'keyboard' : 'pointer')
    },
    // The arrow opens a menu button too (WAI-ARIA APG, menu button).
    onKeyDown: (event) => {
      if (!onTrigger(event) || event.key !== 'ArrowDown') return
      event.preventDefault()
      ask('keyboard')
    },
  }

  const anchor: MenuAnchorProps = {
    open,
    onOpenChange: setOpen,
    opening,
    trigger,
    triggerId,
    contentId,
  }
  return { loaded, triggerProps, anchor }
}

/**
 * A menu of actions behind a "⋯" trigger.
 *
 * Rendered only when it has something to offer: a menu with no items is not a
 * menu, and a control that swallows a press teaches people not to trust the
 * next one (`docs/design/feedback.md`, "nothing interactive is inert").
 */
export function Menu(props: MenuProps) {
  const { loaded, triggerProps, anchor } = useMenuTrigger()
  const styles = menuStyles()

  if (props.items.length === 0) return undefined

  return (
    <button
      {...triggerProps}
      className={buttonClassName({
        variant: 'ghost',
        size: 'sm',
        className: styles.trigger({ className: props.triggerClassName }),
      })}
    >
      <span aria-hidden="true">⋯</span>
      <span className="sr-only">{`More actions for ${props.label}`}</span>
      {loaded === undefined ? undefined : <loaded.RadixMenu {...props} {...anchor} />}
    </button>
  )
}

/**
 * A menu behind a labelled trigger: the ARIA menu button pattern, for a menu
 * that is a place to go rather than a row's "⋯".
 *
 * The same Radix machinery as `Menu` — roving focus, type-ahead, Escape,
 * focus returned to the trigger — with three things `Menu` has no need for:
 * a trigger that shows content of its own, entries that are links, and a
 * group of radio options. A section with nothing in it is dropped, so a caller
 * can describe every section and let permission decide which appear.
 */
export function MenuButton(props: MenuButtonProps) {
  const { loaded, triggerProps, anchor } = useMenuTrigger()
  const styles = menuStyles({ size: 'md' })

  return (
    <button {...triggerProps} className={styles.buttonTrigger()}>
      <span className="sr-only">{props.label}</span>
      <span aria-hidden="true" className={styles.buttonContent()}>
        {props.children}
      </span>
      {loaded === undefined ? undefined : <loaded.RadixMenuButton {...props} {...anchor} />}
    </button>
  )
}
