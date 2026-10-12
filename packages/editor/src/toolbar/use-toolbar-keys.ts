import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Keyboard movement inside a toolbar, as the WAI-ARIA toolbar pattern has it:
 * the arrows move between the controls, Home and End go to the ends, and the
 * movement wraps. The toolbar floats over a document whose caret is in the
 * editor, so it is not in the tab order; `focusToolbar` is how the keyboard
 * reaches it (Alt+F10), and Escape is how it gets back.
 */

const ITEM = '[data-toolbar-item]:not(:disabled)'

function itemsOf(toolbar: HTMLElement): readonly HTMLElement[] {
  return [...toolbar.querySelectorAll<HTMLElement>(ITEM)]
}

/** Where a key moves focus, given where it is now; `null` when the key is not a movement. */
export function nextItem(current: number, count: number, key: string): number | null {
  if (count === 0) return null
  if (key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowLeft') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Focuses the first control, which is where a keyboard user enters the toolbar. */
export function focusToolbar(toolbar: HTMLElement | null): boolean {
  const [first] = toolbar === null ? [] : itemsOf(toolbar)
  first?.focus()
  return first !== undefined
}

/**
 * Handles a key pressed while focus is on one of the toolbar's controls. Returns
 * true when the toolbar used the key, so the caller can stop it reaching anything
 * else.
 */
export function handleToolbarKey(
  event: ReactKeyboardEvent<HTMLElement>,
  leave: () => void,
): boolean {
  // An open menu or a text box inside the toolbar owns its own arrows and Escape,
  // and a chord such as Ctrl+End belongs to whatever it means elsewhere, not to
  // the toolbar's own movement.
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  if (!(event.target instanceof HTMLElement) || !event.target.matches(ITEM)) return false
  if (event.key === 'Escape') {
    leave()
    return true
  }
  const items = itemsOf(event.currentTarget)
  const to = nextItem(items.indexOf(event.target), items.length, event.key)
  if (to === null) return false
  items[to]?.focus()
  return true
}
