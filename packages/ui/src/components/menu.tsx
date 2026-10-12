import { useId, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'
import { buttonClassName } from './button.tsx'
import { CheckIcon } from './icons.tsx'

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
      'flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-start',
      'text-foreground outline-hidden select-none',
      'data-highlighted:bg-surface',
      'data-disabled:pointer-events-none data-disabled:opacity-50',
    ],
    /* The parts only `MenuButton` draws. */
    buttonTrigger: [
      'flex h-8 max-w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-1 text-sm',
      'text-foreground-soft transition-colors ease-standard',
      'hover:bg-surface hover:text-foreground',
      'data-[state=open]:bg-surface data-[state=open]:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    buttonContent: 'flex min-w-0 items-center gap-2',
    header: 'flex min-w-0 flex-col gap-0.5 px-2.5 pt-2 pb-2',
    groupLabel: 'px-2.5 pt-2 pb-1 text-2xs font-medium text-muted',
    separator: '-mx-1 my-1 h-px bg-border',
    // The accent marks the one chosen option and nothing else in the panel.
    indicator: 'ms-auto text-accent',
    // A row's own parts: the picture before its words, the words, and what it is set to after them.
    rowIcon: 'flex size-4 shrink-0 items-center justify-center text-muted',
    rowLabel: 'min-w-0 flex-1 truncate',
    rowHint: 'shrink-0 text-xs text-muted',
  },
  variants: {
    /**
     * `sm` for a row's "⋯" actions, where the panel sits among the tree's
     * small text; `md` for a menu that is a destination in its own right —
     * the person menu in the top bar — and is read like navigation.
     */
    size: {
      sm: { item: 'text-xs' },
      md: { item: 'gap-2 px-2.5 text-sm', content: 'w-64 max-w-[calc(100vw-1rem)]' },
    },
  },
  defaultVariants: { size: 'sm' },
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

/**
 * One row of a `MenuButton`.
 *
 * - `action` runs something here and now (sign out), or cycles a setting and
 *   stays open (`keepOpen`).
 * - `link` goes somewhere, and is rendered as a real anchor through the link
 *   seam, so it can be opened in a new tab and is announced as what it is.
 * - `choice` is a set of mutually exclusive options — the colour scheme —
 *   rendered as `menuitemradio`s with the chosen one checked.
 */
/** What a row can show beside its words, and does whichever kind of row it is. */
interface RowDetails {
  /** A small picture before the words, for finding the row by sight; hidden from assistive technology. */
  readonly icon?: ReactNode
  /** What the row is set to, after the words: "Appearance" with "System". Announced when it changes. */
  readonly hint?: string | undefined
}

export type MenuEntry =
  | (RowDetails & {
      readonly kind: 'action'
      readonly label: string
      readonly onSelect: () => void
      readonly disabled?: boolean | undefined
      /** Stays open after it runs, for a row that is pressed again: one that cycles a setting. */
      readonly keepOpen?: boolean | undefined
    })
  | (RowDetails & { readonly kind: 'link'; readonly label: string; readonly target: LinkTarget })
  | {
      readonly kind: 'choice'
      /** Names the group of options, for sight and for assistive technology. */
      readonly label: string
      readonly value: string
      readonly options: readonly { readonly value: string; readonly label: string }[]
      readonly onValueChange: (value: string) => void
    }

/** A run of entries with an optional heading; sections are divided by a hairline. */
export interface MenuSection {
  readonly id: string
  readonly label?: string | undefined
  readonly entries: readonly MenuEntry[]
}

export interface MenuButtonProps {
  /**
   * The trigger's accessible name. It must contain the trigger's visible words
   * (WCAG 2.5.3), so a caller whose trigger shows a name says it here too.
   */
  readonly label: string
  /** What the trigger shows. It is hidden from assistive technology, which hears `label`. */
  readonly children: ReactNode
  /** A non-interactive block at the top of the panel, such as who is signed in. */
  readonly header?: ReactNode
  readonly sections: readonly MenuSection[]
  /** How `link` entries are rendered; the application passes its router's. */
  readonly linkComponent?: LinkComponent | undefined
  readonly align?: 'start' | 'end'
  readonly className?: string | undefined
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
export function MenuButton({
  label,
  children,
  header,
  sections,
  linkComponent = PlainLink,
  align = 'end',
  className,
}: MenuButtonProps) {
  const styles = menuStyles({ size: 'md' })
  const ids = useId()
  const shown = sections.filter((section) => section.entries.length > 0)

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={styles.buttonTrigger()}>
        {/* Named by its own words rather than `aria-label`, the way `Menu`'s
            trigger is: the name is the same at every width even when part of
            what the trigger shows is hidden, and a test looking for a
            labelled field does not find a button whose label happens to
            contain the same letters. */}
        <span className="sr-only">{label}</span>
        <span aria-hidden="true" className={styles.buttonContent()}>
          {children}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
