import { useId, type CSSProperties, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'

import { tv } from '../lib/class-names.ts'
import { CheckIcon, ChevronRightIcon } from './icons.tsx'
import { menuStyles } from './menu.tsx'

/**
 * A menu opened at a place rather than from a button: a right-click, the
 * context-menu key, a long press, or a control that is not a menu button of
 * its own (a toolbar's "Turn into").
 *
 * The same Radix machinery as `Menu` and `MenuButton` — roving focus, type
 * ahead, Escape, a click elsewhere to close — anchored to a rectangle the
 * caller measures: a point where the pointer was, the caret's box, or a
 * control's. On a phone it is a sheet along the bottom of the screen, every
 * row a thumb's height, and a submenu is laid out in place under its name
 * rather than flying out sideways off the screen.
 *
 * Every entry says why it cannot be used when it cannot, in words under its
 * label rather than in a tooltip a disabled item never shows
 * (`docs/design/feedback.md`, "Disable or hide").
 */

export const contextMenuStyles = tv({
  slots: {
    anchor: 'pointer-events-none fixed block',
    // As wide as its longest entry, so no label is cut short or run into
    // its shortcut, and never wider than the screen.
    content: [
      'w-max min-w-56 max-w-[min(30rem,calc(100vw-1rem))]',
      'max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto',
    ],
    sheet: [
      'w-(--radix-dropdown-menu-trigger-width) max-h-[70dvh] rounded-b-none border-x-0 border-b-0',
      'pb-[max(0.25rem,env(safe-area-inset-bottom))]',
    ],
    entry: 'gap-2.5',
    entryRow: 'min-h-11 text-sm',
    icon: 'flex size-4 shrink-0 items-center justify-center text-muted',
    text: 'flex min-w-0 grow flex-col',
    label: 'whitespace-nowrap',
    reason: 'text-2xs leading-snug text-muted',
    shortcut: 'ms-auto shrink-0 ps-4 font-mono text-2xs text-muted',
    chevron: 'ms-auto text-muted',
  },
  variants: {
    tone: { danger: { label: 'text-danger' }, neutral: {} },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface ContextMenuAction {
  readonly kind: 'action'
  readonly id: string
  readonly label: string
  /** Decorative; the label carries the meaning. */
  readonly icon?: ReactNode
  /** The keyboard shortcut that does the same, as it is pressed: `Ctrl+B`. */
  readonly shortcut?: string | undefined
  /** Why it cannot be used now; absent when it can. */
  readonly disabledReason?: string | undefined
  /** A destructive action, said in words as well as colour. */
  readonly tone?: 'danger' | undefined
  /** A setting that is on or off: drawn as a checked item, announced as one. */
  readonly checked?: boolean | undefined
  onSelect(): void
}

export interface ContextMenuChoice {
  readonly kind: 'choice'
  readonly id: string
  /** Names the group of options. */
  readonly label: string
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
    /** Decorative, as an entry's is: a callout type's mark, a block kind's glyph. */
    readonly icon?: ReactNode
    readonly disabledReason?: string | undefined
  }[]
  onValueChange(value: string): void
}

export interface ContextMenuSubmenu {
  readonly kind: 'submenu'
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
  readonly entries: readonly (ContextMenuAction | ContextMenuChoice)[]
}

export type ContextMenuEntry = ContextMenuAction | ContextMenuChoice | ContextMenuSubmenu

/** A run of entries, divided from the next by a hairline. */
export interface ContextMenuSection {
  readonly id: string
  readonly label?: string | undefined
  readonly entries: readonly ContextMenuEntry[]
}

/** Where the menu hangs from, in the viewport's pixels: a point is a box of no size. */
export interface ContextMenuAnchor {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ContextMenuProps {
  readonly open: boolean
  /** What the menu is for, which names it: "Text", "Table cell". */
  readonly label: string
  readonly anchor: ContextMenuAnchor
  readonly sections: readonly ContextMenuSection[]
  /** `sheet` on a phone: along the bottom edge, full width, rows a thumb's height. */
  readonly presentation?: 'menu' | 'sheet'
  onOpenChange(open: boolean): void
  /**
   * Where focus goes when the menu closes. Radix would return it to the
   * anchor, which is not focusable; the caller says where the person was.
   */
  onCloseFocus?(): void
}

const styles = contextMenuStyles()

/** Where the anchor is: a measured place, which no utility or token can say. */
function anchorStyle(box: ContextMenuAnchor): CSSProperties {
  return { left: box.x, top: box.y, width: box.width, height: box.height }
}

/** The anchor a sheet hangs from: the bottom edge of the screen, its whole width. */
function sheetAnchor(): ContextMenuAnchor {
  return { x: 0, y: globalThis.innerHeight, width: globalThis.innerWidth, height: 0 }
}

export function ContextMenu({
  open,
  label,
  anchor,
  sections,
  presentation = 'menu',
  onOpenChange,
  onCloseFocus,
}: ContextMenuProps) {
  const ids = useId()
  const sheet = presentation === 'sheet'
  const box = sheet ? sheetAnchor() : anchor
  const shown = sections.filter((section) => section.entries.length > 0)
  const menu = menuStyles({ size: 'md' })

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <span aria-hidden="true" className={styles.anchor()} style={anchorStyle(box)} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          // Named by its own label, not by the anchor Radix would name it by,
          // which is an empty box.
          aria-labelledby={undefined}
          side={sheet ? 'top' : 'bottom'}
          align="start"
          sideOffset={sheet ? 0 : 2}
          collisionPadding={sheet ? 0 : 8}
          data-presentation={presentation}
          className={menu.content({
            className: sheet ? styles.sheet() : styles.content(),
          })}
          onCloseAutoFocus={(event) => {
            if (onCloseFocus === undefined) return
            event.preventDefault()
            onCloseFocus()
          }}
        >
          {shown.map((section, index) => {
            const labelId = `${ids}-${section.id}`
            return (
              <DropdownMenu.Group
                key={section.id}
                {...(section.label === undefined ? {} : { 'aria-labelledby': labelId })}
              >
                {index === 0 ? undefined : <DropdownMenu.Separator className={menu.separator()} />}
                {section.label === undefined ? undefined : (
                  <DropdownMenu.Label id={labelId} className={menu.groupLabel()}>
                    {section.label}
                  </DropdownMenu.Label>
                )}
                {section.entries.map((entry) => (
                  <Entry key={entry.id} entry={entry} sheet={sheet} idPrefix={labelId} />
                ))}
              </DropdownMenu.Group>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

interface EntryProps {
  readonly entry: ContextMenuEntry
  readonly sheet: boolean
  readonly idPrefix: string
}

function Entry({ entry, sheet, idPrefix }: EntryProps) {
  const menu = menuStyles({ size: 'md' })
  const item = menu.item({ className: [styles.entry(), sheet ? styles.entryRow() : undefined] })

  switch (entry.kind) {
    case 'action': {
      const reasonId = `${idPrefix}-${entry.id}-reason`
      const shortcutId = `${idPrefix}-${entry.id}-shortcut`
      const tone = contextMenuStyles({ tone: entry.tone ?? 'neutral' })
      // The entry is named by its label alone, so it is found and announced
      // by what it does; why it is disabled, and its shortcut, describe it.
      const describedBy = [
        entry.disabledReason === undefined ? undefined : reasonId,
        entry.shortcut === undefined || sheet ? undefined : shortcutId,
      ]
        .filter((id) => id !== undefined)
        .join(' ')
      const common = {
        disabled: entry.disabledReason !== undefined,
        onSelect: entry.onSelect,
        className: item,
        ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
      }
      const body = (
        <>
          <span className={styles.icon()}>{entry.icon}</span>
          <span className={styles.text()}>
            <span className={tone.label()}>{entry.label}</span>
            {entry.disabledReason === undefined ? undefined : (
              <span id={reasonId} aria-hidden="true" className={styles.reason()}>
                {entry.disabledReason}
              </span>
            )}
          </span>
          {/* A sheet is for a finger, which has no keyboard shortcuts. */}
          {entry.shortcut === undefined || sheet ? undefined : (
            <kbd id={shortcutId} aria-hidden="true" className={styles.shortcut()}>
              {entry.shortcut}
            </kbd>
          )}
        </>
      )
      if (entry.checked === undefined)
        return <DropdownMenu.Item {...common}>{body}</DropdownMenu.Item>
      return (
        <DropdownMenu.CheckboxItem {...common} checked={entry.checked}>
          {body}
          <DropdownMenu.ItemIndicator className={menu.indicator()}>
            <CheckIcon />
          </DropdownMenu.ItemIndicator>
        </DropdownMenu.CheckboxItem>
      )
    }
    case 'choice': {
      const labelId = `${idPrefix}-${entry.id}`
      return (
        <DropdownMenu.RadioGroup
          value={entry.value}
          onValueChange={entry.onValueChange}
          aria-labelledby={labelId}
        >
          <DropdownMenu.Label id={labelId} className={menu.groupLabel()}>
            {entry.label}
          </DropdownMenu.Label>
          {entry.options.map((option) => (
            <DropdownMenu.RadioItem
              key={option.value}
              value={option.value}
              disabled={option.disabledReason !== undefined}
              className={item}
            >
              {option.icon === undefined ? undefined : (
                <span className={styles.icon()}>{option.icon}</span>
              )}
              <span className={styles.text()}>
                <span className={styles.label()}>{option.label}</span>
                {option.disabledReason === undefined ? undefined : (
                  <span className={styles.reason()}>{option.disabledReason}</span>
                )}
              </span>
              <DropdownMenu.ItemIndicator className={menu.indicator()}>
                <CheckIcon />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      )
    }
    case 'submenu': {
      if (sheet) {
        // Laid out in place: a submenu flying out sideways has nowhere to go on a phone.
        const labelId = `${idPrefix}-${entry.id}`
        return (
          <DropdownMenu.Group aria-labelledby={labelId}>
            <DropdownMenu.Label id={labelId} className={menu.groupLabel()}>
              {entry.label}
            </DropdownMenu.Label>
            {entry.entries.map((inner) => (
              <Entry key={inner.id} entry={inner} sheet idPrefix={labelId} />
            ))}
          </DropdownMenu.Group>
        )
      }
      return (
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger className={item}>
            <span className={styles.icon()}>{entry.icon}</span>
            <span className={styles.text()}>
              <span className={styles.label()}>{entry.label}</span>
            </span>
            <ChevronRightIcon className={styles.chevron()} />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent
              sideOffset={4}
              collisionPadding={8}
              className={menu.content({ className: styles.content() })}
            >
              {entry.entries.map((inner) => (
                <Entry
                  key={inner.id}
                  entry={inner}
                  sheet={false}
                  idPrefix={`${idPrefix}-${entry.id}`}
                />
              ))}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      )
    }
  }
}
