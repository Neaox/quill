import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useId, useSyncExternalStore } from 'react'
import { tv } from 'tailwind-variants'

import { runAt, useMenuNavigation } from '../menu/use-menu-navigation.ts'
import type { SlashStore } from './slash-store.ts'

/**
 * The insert menu the slash key opens.
 *
 * It is a listbox the caret drives: focus stays in the document, so the editor's
 * own element carries the combobox state â€” expanded, which list, and which
 * option is active â€” and the keys arrive through the suggestion plugin. That is
 * what makes the menu usable without a mouse and announceable by a screen
 * reader, neither of which a floating div with click handlers would be.
 */

/**
 * The parts of the menu in one definition. Which item is active is said once, by
 * the document's `aria-activedescendant`, and the item carries a boolean
 * attribute that the colour follows — never a class chosen in JSX.
 */
const slashMenu = tv({
  slots: {
    root:
      'slash-menu fixed z-20 max-h-80 min-w-64 overflow-y-auto rounded-md border ' +
      'border-border-strong/70 bg-surface-raised p-1 shadow-raised',
    item: 'cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-surface data-active:bg-surface',
    label: 'font-medium text-foreground',
    description: 'block text-xs text-foreground-muted',
    empty: 'px-2 py-1.5 text-sm text-foreground-muted',
  },
})

const styles = slashMenu()

export interface SlashMenuProps {
  readonly store: SlashStore
  readonly editor: Editor | null
  readonly className?: string
}

export function SlashMenu({ store, editor, className }: SlashMenuProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const baseId = useId()
  const listId = `${baseId}-list`

  const select = useCallback(
    (index: number) => {
      runAt(
        snapshot.items.map((item) => () => {
          snapshot.apply(item)
        }),
        index,
      )
    },
    [snapshot],
  )

  const { activeIndex, setActiveIndex, handleKey } = useMenuNavigation({
    count: snapshot.items.length,
    onSelect: select,
    onDismiss: store.close,
  })

  // Wires this menu's key handling into the external SlashStore so the
  // ProseMirror suggestion plugin — which owns the keydown outside React — can
  // route keys to whichever item is active.
  useEffect(() => {
    store.setKeyHandler(handleKey)
    return () => {
      store.setKeyHandler(null)
    }
  }, [store, handleKey])

  const activeId = activeIndex < 0 ? null : `${baseId}-${String(activeIndex)}`

  // The active-descendant state belongs on the element that holds focus, which
  // is the document itself; ProseMirror owns that element, so it is set here by
  // hand. `role="textbox"` only admits `aria-activedescendant` of the three —
  // `aria-expanded` and `aria-controls` belong to `combobox`, which this
  // element is not — so the open list and its id are read from the DOM
  // structure itself rather than said twice.
  useEffect(() => {
    const dom = editor?.view.dom
    if (dom === undefined) return
    if (!snapshot.open) return
    if (activeId !== null) dom.setAttribute('aria-activedescendant', activeId)
    return () => {
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor, snapshot.open, activeId])

  if (!snapshot.open) return null

  const position =
    snapshot.rect === null ? undefined : { top: snapshot.rect.bottom, left: snapshot.rect.left }

  return (
    <div
      id={listId}
      role="listbox"
      aria-label="Insert"
      className={styles.root({ class: className })}
      style={position}
    >
      {snapshot.items.length === 0 ? (
        <p className={styles.empty()}>No matching block</p>
      ) : (
        snapshot.items.map((item, index) => (
          <div
            key={item.id}
            id={`${baseId}-${String(index)}`}
            role="option"
            aria-selected={index === activeIndex}
            tabIndex={-1}
            data-active={index === activeIndex || undefined}
            data-group={item.group}
            className={styles.item()}
            onMouseEnter={() => {
              setActiveIndex(index)
            }}
            onMouseDown={(event) => {
              // The document must keep the selection the item is about to act on.
              event.preventDefault()
              snapshot.apply(item)
            }}
          >
            <span className={styles.label()}>{item.label}</span>
            <span className={styles.description()}>{item.description}</span>
          </div>
        ))
      )}
    </div>
  )
}
