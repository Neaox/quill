import { useCallback, useState } from 'react'

/**
 * Keyboard navigation for a single-select list of commands.
 *
 * The block menu and the slash menu are the same interaction — move through a
 * short list, choose one, or give up — wearing different ARIA roles, so the
 * behaviour is written once here and the roles are written where the markup is.
 * The movement itself is a pure function, which is where the wrapping, the
 * clamping, and the "this key is not ours" answer are tested.
 */

/** Where a key moves the active item, or null when the key means nothing here. */
export function nextIndex(current: number, count: number, key: string): number | null {
  if (count === 0) return null
  if (key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * Runs the action at an index, if the list still has one there.
 *
 * A menu's list changes as the author types while the index that was chosen a
 * keystroke ago does not, so the two can disagree. Answering that once, here,
 * keeps every call site free of a guard it would otherwise repeat.
 */
export function runAt(actions: readonly (() => void)[], index: number): boolean {
  const action = actions[index]
  if (action === undefined) return false
  action()
  return true
}

export interface MenuNavigationOptions {
  readonly count: number
  onSelect(index: number): void
  onDismiss(): void
}

export interface MenuNavigation {
  readonly activeIndex: number
  setActiveIndex(index: number): void
  /** True when the key was the menu's to handle, so the caller stops the event. */
  handleKey(key: string): boolean
}

export function useMenuNavigation({
  count,
  onSelect,
  onDismiss,
}: MenuNavigationOptions): MenuNavigation {
  const [requested, setRequested] = useState(0)
  // Clamped on read rather than corrected in an effect: the list shrinks as the
  // author types, and an effect would render one frame pointing at nothing.
  const activeIndex = count === 0 ? -1 : Math.min(requested, count - 1)

  const handleKey = useCallback(
    (key: string): boolean => {
      const moved = nextIndex(activeIndex, count, key)
      if (moved !== null) {
        setRequested(moved)
        return true
      }
      if (key === 'Enter' || key === 'Tab') {
        if (activeIndex < 0) return false
        onSelect(activeIndex)
        return true
      }
      if (key === 'Escape') {
        onDismiss()
        return true
      }
      return false
    },
    [activeIndex, count, onSelect, onDismiss],
  )

  return { activeIndex, setActiveIndex: setRequested, handleKey }
}
