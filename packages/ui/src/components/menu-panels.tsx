import { useId, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'

import { PlainLink, type LinkComponent } from '../lib/link.tsx'
import { CheckIcon } from './icons.tsx'
import {
  menuStyles,
  type MenuButtonProps,
  type MenuAnchorProps,
  type MenuEntry,
  type MenuOpening,
  type MenuProps,
} from './menu-model.ts'

/**
 * The menus' Radix half, fetched on demand (`menu.tsx`).
 *
 * There were two hand-rolled versions of the "more actions" disclosure — one
 * beside every tree row and collection, one in the document header — and
 * neither implemented the keyboard model both claimed by writing
 * `role="menu"` and `role="menuitem"`: arrow keys did nothing, the first item
 * was never focused on open, there was no type-ahead, and focus did not return
 * to the trigger on close. Radix's `DropdownMenu` is that model, correctly:
 * roving focus with Up, Down, Home and End, printable-character type-ahead,
 * Escape and outside-click to close, focus restored to the trigger,
 * `aria-haspopup`/`aria-expanded` on the trigger and
 * `aria-activedescendant`-free real focus inside, plus collision handling so
 * the panel is never drawn off screen.
 *
 * It is also most of what a menu weighs, and none of it draws anything until
 * somebody opens one, so a page renders its triggers without it — and keeps
 * them: the panel here hangs from the light trigger `menu.tsx` drew, through
 * an inert box laid over it, rather than drawing a trigger of its own
 * (`AnchoredRoot`).
 */

/**
 * A menu opened by a key press that landed before this module did.
 *
 * Radix focuses the first item of a keyboard-opened menu because its root saw
 * the key press; a root mounted after the press did not, and focuses the panel
 * instead. So the first time the panel itself takes focus, it is passed on to
 * the first item, which is where the keyboard model says it belongs.
 */
function firstItemFocus(opening: MenuOpening | undefined) {
  let pending = opening === 'keyboard'
  return (event: FocusEvent<HTMLDivElement>) => {
    if (!pending || event.target !== event.currentTarget) return
    pending = false
    event.currentTarget
      .querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])')
      ?.focus()
  }
}

interface AnchoredRootProps extends MenuAnchorProps {
  readonly align: 'start' | 'end'
  readonly sideOffset: number
  readonly className: string
  readonly children: ReactNode
}

/**
 * Radix's menu, attached to a trigger it did not draw.
 *
 * Its own trigger is an inert box over the real one (`menuStyles().anchor`):
 * the panel is positioned against it, and nothing else about it is used. The
 * real trigger owns the open state and the ARIA (`menu.tsx`); here the panel
 * is labelled by it, a press on it is not treated as a press outside (the
 * trigger's own click closes the menu), and focus goes back to it on close —
 * unless the menu was closed by pressing somewhere else, where focus belongs
 * to whatever was pressed.
 */
function AnchoredRoot({
  open,
  onOpenChange,
  opening,
  trigger,
  triggerId,
  contentId,
  align,
  sideOffset,
  className,
  children,
}: AnchoredRootProps) {
  // Once per mount: the press it answers happened once.
  const [onFocus] = useState(() => firstItemFocus(opening))
  const pressedElsewhere = useRef(false)

  return (
    /*
     * Not modal. A modal menu locks the page's scroll and hides everything
     * behind it from assistive technology, which is right for a dialog and
     * wrong for a small list of actions hanging off one row: the scroll lock
     * shifts the page as the panel opens, and a press on another row is
     * swallowed by the overlay instead of going where it was aimed.
     */
    <DropdownMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <span aria-hidden="true" className={menuStyles().anchor()} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          id={contentId}
          aria-labelledby={triggerId}
          onFocus={onFocus}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** A menu of actions behind a "⋯" trigger. See `Menu`. */
export function RadixMenu({
  items,
  align = 'end',
  className,
  ...anchor
}: MenuProps & MenuAnchorProps) {
  const styles = menuStyles()

  return (
    <AnchoredRoot
      {...anchor}
      align={align}
      sideOffset={4}
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
    </AnchoredRoot>
  )
}

/** A menu behind a labelled trigger. See `MenuButton`. */
export function RadixMenuButton({
  header,
  sections,
  linkComponent = PlainLink,
  align = 'end',
  className,
  open,
  onOpenChange,
  opening,
  trigger,
  triggerId,
  contentId,
}: MenuButtonProps & MenuAnchorProps) {
  const styles = menuStyles({ size: 'md' })
  const ids = useId()
  const shown = sections.filter((section) => section.entries.length > 0)

  return (
    <AnchoredRoot
      open={open}
      onOpenChange={onOpenChange}
      opening={opening}
      trigger={trigger}
      triggerId={triggerId}
      contentId={contentId}
      align={align}
      sideOffset={6}
      className={styles.content({ className })}
    >
      {header === undefined ? undefined : <div className={styles.header()}>{header}</div>}
      {shown.map((section, index) => {
        const labelId = `${ids}-${section.id}`
        return (
          <DropdownMenu.Group
            key={section.id}
            {...(section.label === undefined ? {} : { 'aria-labelledby': labelId })}
          >
            {index === 0 && header === undefined ? undefined : (
              <DropdownMenu.Separator className={styles.separator()} />
            )}
            {section.label === undefined ? undefined : (
              <DropdownMenu.Label id={labelId} className={styles.groupLabel()}>
                {section.label}
              </DropdownMenu.Label>
            )}
            {section.entries.map((entry, position) => (
              <MenuButtonEntry
                key={entry.label}
                entry={entry}
                linkComponent={linkComponent}
                labelId={`${labelId}-${position}`}
              />
            ))}
          </DropdownMenu.Group>
        )
      })}
    </AnchoredRoot>
  )
}

function MenuButtonEntry({
  entry,
  linkComponent: LinkElement,
  labelId,
}: {
  readonly entry: MenuEntry
  readonly linkComponent: LinkComponent
  readonly labelId: string
}) {
  const styles = menuStyles({ size: 'md' })

  switch (entry.kind) {
    case 'action':
      return (
        <DropdownMenu.Item
          disabled={entry.disabled === true}
          onSelect={(event) => {
            if (entry.keepOpen === true) event.preventDefault()
            entry.onSelect()
          }}
          className={styles.item()}
        >
          <RowContent entry={entry} />
        </DropdownMenu.Item>
      )
    case 'link':
      return (
        // `asChild`: the anchor *is* the menu item, so there is one
        // interactive element where assistive technology expects one, and the
        // browser's own "open in new tab" still works on it.
        <DropdownMenu.Item asChild>
          <LinkElement {...entry.target} className={styles.item()}>
            <RowContent entry={entry} />
          </LinkElement>
        </DropdownMenu.Item>
      )
    case 'choice':
      return (
        <DropdownMenu.RadioGroup
          value={entry.value}
          onValueChange={entry.onValueChange}
          aria-labelledby={labelId}
        >
          <DropdownMenu.Label id={labelId} className={styles.groupLabel()}>
            {entry.label}
          </DropdownMenu.Label>
          {entry.options.map((option) => (
            <DropdownMenu.RadioItem
              key={option.value}
              value={option.value}
              // The panel stays open on a choice: the scheme changes under it,
              // so the person sees the result and can try another.
              onSelect={(event) => {
                event.preventDefault()
              }}
              className={styles.item()}
            >
              {option.label}
              <DropdownMenu.ItemIndicator className={styles.indicator()}>
                <CheckIcon />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      )
  }
}

/**
 * The inside of a row: its icon, its words, and what it is set to. The hint is read after the
 * words with a colon ("Appearance: System") and is a polite live region, because a row that
 * cycles a setting keeps the focus, and a change of name under a focused item is not reliably read.
 */
function RowContent({
  entry,
}: {
  readonly entry: Extract<MenuEntry, { readonly kind: 'action' | 'link' }>
}) {
  const styles = menuStyles({ size: 'md' })
  return (
    <>
      {entry.icon === undefined ? undefined : (
        <span aria-hidden="true" className={styles.rowIcon()}>
          {entry.icon}
        </span>
      )}
      <span className={styles.rowLabel()}>
        {entry.label}
        {entry.hint === undefined ? undefined : <span className="sr-only">{': '}</span>}
      </span>
      {entry.hint === undefined ? undefined : (
        <span aria-live="polite" className={styles.rowHint()}>
          {entry.hint}
        </span>
      )}
    </>
  )
}
