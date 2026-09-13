import { DropdownMenu } from 'radix-ui'

import { tv } from '../lib/class-names.ts'
import { buttonClassName } from './button.tsx'

/**
 * The "more actions" disclosure, in one place.
 *
 * There were two hand-rolled versions of this — one beside every tree row and
 * collection, one in the document header — and neither implemented the
 * keyboard model both claimed by writing `role="menu"` and `role="menuitem"`:
 * arrow keys did nothing, the first item was never focused on open, there was
 * no type-ahead, and focus did not return to the trigger on close. Radix's
 * `DropdownMenu` is that model, correctly: roving focus with Up, Down, Home
 * and End, printable-character type-ahead, Escape and outside-click to close,
 * focus restored to the trigger, `aria-haspopup`/`aria-expanded` on the
 * trigger and `aria-activedescendant`-free real focus inside, plus collision
 * handling so the panel is never drawn off screen.
 *
 * `tokens.css` owns the open and close animation, keyed on Radix's own
 * `data-state`, exactly as the dialog's is.
 */
export const menuStyles = tv({
  slots: {
    trigger: 'flex size-7 shrink-0 items-center justify-center px-0',
    content: [
      'menu-panel z-50 min-w-40 rounded-md border border-border bg-surface-raised p-1',
      'shadow-raised',
    ],
    item: [
      'flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-start text-xs',
      'text-foreground outline-hidden select-none',
      'data-highlighted:bg-surface',
      'data-disabled:pointer-events-none data-disabled:opacity-50',
    ],
  },
})

export interface MenuItem {
  readonly label: string
  readonly onSelect: () => void
  readonly disabled?: boolean | undefined
}

export interface MenuProps {
  /**
   * What the actions act on. It becomes the trigger's accessible name —
   * "More actions for Failover" — so a screen reader announces which row's
   * menu this is, which three identical "More actions" buttons would not.
   */
  readonly label: string
  readonly items: readonly MenuItem[]
  /** Which edge of the trigger the panel lines up with. */
  readonly align?: 'start' | 'end'
  /** Extra classes for the trigger, for a row that needs a different size. */
  readonly triggerClassName?: string | undefined
  readonly className?: string | undefined
}

/**
 * A menu of actions behind a "⋯" trigger.
 *
 * Rendered only when it has something to offer: a menu with no items is not a
 * menu, and a control that swallows a press teaches people not to trust the
 * next one (`docs/design/feedback.md`, "nothing interactive is inert").
 */
export function Menu({ label, items, align = 'end', triggerClassName, className }: MenuProps) {
  const styles = menuStyles()

  if (items.length === 0) return undefined

  return (
    /*
     * Not modal. A modal menu locks the page's scroll and hides everything
     * behind it from assistive technology, which is right for a dialog and
     * wrong for a small list of actions hanging off one row: the scroll lock
     * shifts the page as the panel opens, and a press on another row is
     * swallowed by the overlay instead of going where it was aimed.
     */
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={buttonClassName({
          variant: 'ghost',
          size: 'sm',
          className: styles.trigger({ className: triggerClassName }),
        })}
      >
        <span aria-hidden="true">⋯</span>
        <span className="sr-only">{`More actions for ${label}`}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className={styles.content({ className })}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              disabled={item.disabled === true}
              onSelect={item.onSelect}
              className={styles.item()}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
