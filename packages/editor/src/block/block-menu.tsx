import { Button, buttonClassName } from '@quill/ui'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'

import { runAt, useMenuNavigation } from '../menu/use-menu-navigation.ts'
import { setBlockWidth } from './commands.ts'
import { BLOCK_ACTIONS, BLOCK_WIDTHS, describeBlockMenu, widthLabel } from './block-state.ts'

/**
 * The menu every block carries (the plan document, section 17).
 *
 * It follows the caret rather than the pointer, so it is reachable with a
 * keyboard and not only with a mouse: the trigger names the block it acts on, and
 * the popup is a menu with a radio group for the three widths of ADR-027 and one
 * item per action. Adding a comment is an event, not a command — comments are
 * the web application's, anchored by ADR-022 — so the menu reports the range and
 * stops there.
 */

/**
 * One definition for the parts of the menu, so its layout reads in one place and
 * a state is never a class chosen in JSX. Appearance comes from the design
 * system's button; only the arrangement and the active-item colour are here.
 */
const blockMenu = tv({
  slots: {
    root: 'block-menu relative',
    popup:
      'block-menu-popup absolute z-10 min-w-44 rounded-md border border-border-strong/70 ' +
      'bg-surface-raised p-1 shadow-raised',
    group: 'block-menu-widths contents',
    item: 'w-full justify-start data-active:bg-surface',
  },
})

const styles = blockMenu()

/** What choosing a disabled item does. */
function doNothing(): void {}

export interface CommentRequest {
  readonly from: number
  readonly to: number
  readonly text: string
}

export interface BlockMenuProps {
  readonly editor: Editor | null
  readonly onComment?: (request: CommentRequest) => void
  readonly className?: string
}

interface MenuEntry {
  readonly id: string
  readonly label: string
  readonly role: 'menuitem' | 'menuitemradio'
  readonly checked?: boolean
  readonly disabled: boolean
  run(): void
}

export function BlockMenu({ editor, onComment, className }: BlockMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const wasOpen = useRef(false)
  const baseId = useId()

  const block = useEditorState({
    editor,
    selector: ({ editor: current }) => (current === null ? null : describeBlockMenu(current.state)),
    equalityFn: (a, b) => a?.key === b?.key,
  })

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const entries = useMemo<readonly MenuEntry[]>(() => {
    if (editor === null || block === null) return []
    const run = (act: () => void) => () => {
      act()
      setOpen(false)
      editor.commands.focus()
    }
    const widths: MenuEntry[] = block.canSetWidth
      ? BLOCK_WIDTHS.map((width) => ({
          id: `width-${width}`,
          label: widthLabel(width),
          role: 'menuitemradio',
          checked: block.width === width,
          disabled: false,
          run: run(() => setBlockWidth(width)(editor.state, editor.view.dispatch, editor.view)),
        }))
      : []
    const actions: MenuEntry[] = BLOCK_ACTIONS.map((action) => ({
      id: action.id,
      label: action.label,
      role: 'menuitem',
      disabled: block.enabled[action.id] !== true,
      run: run(() => action.command(editor.state, editor.view.dispatch, editor.view)),
    }))
    const comment: MenuEntry = {
      id: 'comment',
      label: 'Add comment',
      role: 'menuitem',
      disabled: onComment === undefined,
      run: run(() => {
        onComment?.({
          from: block.from,
          to: block.to,
          text: editor.state.doc.textBetween(block.from, block.to, ' '),
        })
      }),
    }
    return [...widths, ...actions, comment]
  }, [editor, block, onComment])

  const select = useCallback(
    (index: number) => {
      runAt(
        entries.map((entry) => (entry.disabled ? doNothing : entry.run)),
        index,
      )
    },
    [entries],
  )

  const { activeIndex, setActiveIndex, handleKey } = useMenuNavigation({
    count: entries.length,
    onSelect: select,
    onDismiss: close,
  })

  // Focus follows the popup: into the menu when it opens, back to the trigger
  // when it closes, and nowhere at all before it has ever been opened.
  useEffect(() => {
    if (open) menuRef.current?.focus()
    else if (wasOpen.current) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  if (editor === null || block === null) return null

  const menuId = `${baseId}-menu`
  const label = `${block.label} options`

  return (
    <div className={styles.root({ class: className })}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName({ variant: 'ghost', size: 'sm' })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          aria-activedescendant={`${baseId}-${String(activeIndex)}`}
          tabIndex={-1}
          className={styles.popup()}
          onKeyDown={(event) => {
            if (handleKey(event.key)) event.preventDefault()
          }}
        >
          {block.canSetWidth ? (
            <fieldset aria-label="Width" className={styles.group()}>
              {entries.slice(0, BLOCK_WIDTHS.length).map((entry, index) => (
                <MenuItem
                  key={entry.id}
                  entry={entry}
                  id={`${baseId}-${String(index)}`}
                  active={index === activeIndex}
                  onActivate={() => {
                    setActiveIndex(index)
                  }}
                />
              ))}
            </fieldset>
          ) : null}
          {entries.slice(block.canSetWidth ? BLOCK_WIDTHS.length : 0).map((entry, offset) => {
            const index = offset + (block.canSetWidth ? BLOCK_WIDTHS.length : 0)
            return (
              <MenuItem
                key={entry.id}
                entry={entry}
                id={`${baseId}-${String(index)}`}
                active={index === activeIndex}
                onActivate={() => {
                  setActiveIndex(index)
                }}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

interface MenuItemProps {
  readonly entry: MenuEntry
  readonly id: string
  readonly active: boolean
  onActivate(): void
}

/**
 * The active item is marked with an attribute and coloured by a variant of it,
 * so which item the keyboard is on is one fact rather than two: a class list in
 * JSX and an `aria-activedescendant` that could disagree with it.
 */
function MenuItem({ entry, id, active, onActivate }: MenuItemProps) {
  return (
    <Button
      id={id}
      variant="ghost"
      size="sm"
      role={entry.role}
      tabIndex={-1}
      aria-checked={entry.role === 'menuitemradio' ? entry.checked === true : undefined}
      disabled={entry.disabled}
      data-active={active || undefined}
      className={styles.item()}
      onMouseEnter={onActivate}
      onClick={entry.run}
    >
      {entry.label}
    </Button>
  )
}
