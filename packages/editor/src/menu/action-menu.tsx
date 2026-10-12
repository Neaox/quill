import type { EditorState } from '@tiptap/pm/state'
import { useCallback, useEffect, useId, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { tv } from 'tailwind-variants'
import type { VariantProps } from 'tailwind-variants'

import { actionState } from '../actions/editor-action.ts'
import type { ActionGroup, ActionState, EditorAction } from '../actions/editor-action.ts'
import { describeShortcut } from '../format/marks.ts'
import { useFloatingPlacement } from '../floating/use-floating-placement.ts'
import type { Locate } from '../floating/use-floating-placement.ts'
import { runAt, useMenuNavigation } from './use-menu-navigation.ts'

/**
 * A menu of editor actions, wherever it is opened from.
 *
 * The context menu opens it at the pointer and the toolbar's drop-downs open it
 * under their button; what they show is a list of `ActionGroup`s and what they
 * do is run the action that was chosen, so the menu itself knows nothing about
 * tables or callouts. It follows the WAI-ARIA menu pattern: `role="menu"` holds
 * focus and names the active item with `aria-activedescendant`, radio and
 * check items carry their state as `aria-checked`, and an item that cannot be
 * used is `aria-disabled` rather than gone, so it can still be found and its
 * label read.
 */

const actionMenu = tv({
  slots: {
    root:
      'action-menu fixed top-0 left-0 z-30 min-w-52 overflow-y-auto overscroll-contain rounded-md ' +
      'border border-border-strong/70 bg-surface-raised p-1 text-sm shadow-raised outline-hidden',
    group: 'flex flex-col not-first:mt-1 not-first:border-t not-first:border-border not-first:pt-1',
    groupLabel: 'meta px-2 pt-1 pb-0.5',
    item: [
      'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start',
      'text-foreground data-active:bg-surface aria-disabled:cursor-default',
      'aria-disabled:text-muted aria-disabled:opacity-60',
    ],
    marker: 'flex size-4 shrink-0 items-center justify-center text-xs',
    swatch: 'size-2.5 shrink-0 rounded-full',
    text: 'flex min-w-0 flex-1 flex-col',
    label: 'truncate',
    description: 'truncate text-2xs leading-snug text-muted',
    keys: [
      'shrink-0 self-center rounded-sm border border-border bg-surface px-1.5 py-0.5',
      'font-mono text-2xs text-muted',
    ],
  },
  variants: {
    tone: {
      neutral: { swatch: 'bg-muted' },
      accent: { swatch: 'bg-accent' },
      success: { swatch: 'bg-success' },
      warning: { swatch: 'bg-warning' },
      danger: { swatch: 'bg-danger' },
    },
    destructive: { true: { item: 'text-danger' } },
    // With a line of explanation beneath it, a label is what the item is called,
    // and the weight is what tells the two lines apart; alone, it is just text.
    described: { true: { label: 'font-medium' } },
  },
})
const styles = actionMenu()

type ItemVariants = VariantProps<typeof actionMenu>

/** Tall enough for a long table menu to be read at a glance; past that it scrolls. */
const MENU_HEIGHT_LIMIT_PX = 420

export type CloseReason = 'escape' | 'outside' | 'chosen'

export interface ActionMenuProps {
  /** The menu's accessible name. */
  readonly label: string
  readonly groups: readonly ActionGroup[]
  /** The document the actions would act on, which decides what is enabled and checked. */
  readonly state: EditorState
  /** Where the menu hangs: the pointer, or a button. */
  readonly locate: Locate
  /**
   * The control that opened the menu, when there is one. A press on it is not "a
   * click elsewhere": it is the control's own to handle, which is how pressing a
   * menu button a second time closes its menu instead of closing and reopening it.
   */
  readonly trigger?: Element | undefined
  /** An enabled item was chosen. The caller runs it, so the menu need not know how. */
  onChoose(action: EditorAction): void
  /**
   * The menu is done, and why: Escape, where focus belongs back with whatever
   * opened it; a click elsewhere, where focus belongs to what was clicked; or an
   * item chosen, after `onChoose` has run it.
   */
  onClose(reason: CloseReason): void
  readonly className?: string
}

interface Row {
  readonly action: EditorAction
  readonly status: ActionState
}

interface Section {
  readonly group: ActionGroup
  readonly rows: readonly Row[]
  readonly offset: number
}

export function ActionMenu({
  label,
  groups,
  state,
  locate,
  trigger,
  onChoose,
  onClose,
  className,
}: ActionMenuProps) {
  const baseId = useId()
  const menu = useRef<HTMLDivElement | null>(null)
  useFloatingPlacement(menu, true, locate, { limit: MENU_HEIGHT_LIMIT_PX })

  // Every action with what the document says about it, and where its group's
  // first action falls in the order the arrows visit them.
  const sections = useMemo<readonly Section[]>(() => {
    const withStatus = groups.map((group) => ({
      group,
      rows: group.actions.map((action) => ({ action, status: actionState(action, state) })),
    }))
    return withStatus.map((section, position) => ({
      ...section,
      offset: withStatus
        .slice(0, position)
        .reduce((count, earlier) => count + earlier.rows.length, 0),
    }))
  }, [groups, state])
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])

  const select = useCallback(
    (index: number) => {
      runAt(
        rows.map((row) => () => {
          if (!row.status.enabled) return
          onChoose(row.action)
          onClose('chosen')
        }),
        index,
      )
    },
    [rows, onChoose, onClose],
  )

  // Focus stays on the menu, so the browser will not scroll the item the arrows chose.
  const bringIntoView = useCallback(
    (index: number) => {
      document.getElementById(`${baseId}-${String(index)}`)?.scrollIntoView({ block: 'nearest' })
    },
    [baseId],
  )

  const { activeIndex, setActiveIndex, handleKey } = useMenuNavigation({
    count: rows.length,
    onSelect: select,
    onDismiss: () => {
      onClose('escape')
    },
    onMove: bringIntoView,
    // A menu of choices opens on the one in force, so the arrows go from where the author is.
    initial: Math.max(
      0,
      rows.findIndex((row) => row.status.checked),
    ),
  })

  // Focus moves into the menu the moment it exists, which is what lets the
  // arrows work. A ref callback runs exactly then, which an effect would only
  // approximate.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      menu.current = node
      node?.focus()
    },
    [menu],
  )

  // A click anywhere else closes the menu: it is modal in spirit, not in markup.
  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      const within = event.composedPath().some((node) => node === menu.current || node === trigger)
      if (!within) onClose('outside')
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
    }
  }, [menu, trigger, onClose])

  return (
    <div
      ref={attach}
      role="menu"
      aria-label={label}
      aria-activedescendant={activeIndex < 0 ? undefined : `${baseId}-${String(activeIndex)}`}
      tabIndex={-1}
      className={styles.root({ class: className })}
      onKeyDown={(event) => {
        // Space chooses, as it does on a button; Tab leaves rather than wandering the page.
        const key = event.key === ' ' ? 'Enter' : event.key === 'Tab' ? 'Escape' : event.key
        if (handleKey(key)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
      }}
    >
      {sections.map(({ group, rows: groupRows, offset }) => (
        <ActionMenuGroup key={group.id} group={group}>
          {groupRows.map((row, position) => {
            const at = offset + position
            return (
              <ActionMenuItem
                key={row.action.id}
                id={`${baseId}-${String(at)}`}
                row={row}
                active={at === activeIndex}
                onActivate={() => {
                  setActiveIndex(at)
                }}
                onChoose={() => {
                  select(at)
                }}
              />
            )
          })}
        </ActionMenuGroup>
      ))}
    </div>
  )
}

function ActionMenuGroup({
  group,
  children,
}: {
  readonly group: ActionGroup
  readonly children: ReactNode
}) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className={styles.group()}>
      <span id={labelId} className={styles.groupLabel()}>
        {group.label}
      </span>
      {children}
    </div>
  )
}

interface ActionMenuItemProps {
  readonly id: string
  readonly row: Row
  readonly active: boolean
  onActivate(): void
  onChoose(): void
}

function ActionMenuItem({ id, row, active, onActivate, onChoose }: ActionMenuItemProps) {
  const { action, status } = row
  const kind = action.kind ?? 'item'
  const role =
    kind === 'radio' ? 'menuitemradio' : kind === 'check' ? 'menuitemcheckbox' : 'menuitem'
  const variants: ItemVariants = {
    ...(action.tone === undefined ? {} : { tone: action.tone }),
    destructive: action.destructive === true,
    described: action.description !== undefined,
  }
  const item = actionMenu(variants)

  // A menu item is chosen from the keyboard at the menu itself, which holds focus
  // and names the active item (aria-activedescendant); the pointer handlers here
  // are the same choice for a mouse, so the item has no key handler of its own.
  /* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
  return (
    <div
      id={id}
      role={role}
      aria-labelledby={`${id}-label`}
      aria-describedby={action.description === undefined ? undefined : `${id}-description`}
      aria-keyshortcuts={action.keys}
      aria-checked={kind === 'item' ? undefined : status.checked}
      aria-disabled={status.enabled ? undefined : true}
      data-active={active || undefined}
      className={item.item()}
      onMouseEnter={onActivate}
      onMouseDown={(event) => {
        // The document keeps the selection the action is about to act on.
        event.preventDefault()
      }}
      onClick={onChoose}
    >
      {kind === 'item' ? null : (
        <span aria-hidden="true" className={item.marker()}>
          {status.checked ? (kind === 'radio' ? '●' : '✓') : null}
        </span>
      )}
      {action.tone === undefined ? null : <span aria-hidden="true" className={item.swatch()} />}
      <span className={item.text()}>
        <span id={`${id}-label`} className={item.label()}>
          {action.label}
        </span>
        {action.description === undefined ? null : (
          <span id={`${id}-description`} className={item.description()}>
            {action.description}
          </span>
        )}
      </span>
      {action.keys === undefined ? null : (
        <kbd aria-hidden="true" className={item.keys()}>
          {describeShortcut(action.keys)}
        </kbd>
      )}
    </div>
  )
  /* oxlint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
}
