import { useEffect } from 'react'

/**
 * Warns before the tab closes while an edit is still buffered. The listener is only
 * attached while there is something to lose, so a clean document never triggers the
 * browser's confirmation dialog. `target` exists so tests can dispatch at an
 * injected `EventTarget` instead of the real window.
 */
export function useUnsavedChangesGuard(hasUnsavedChanges: boolean, target?: EventTarget): void {
  // Listens for the window's (or an injected target's) `beforeunload` event to
  // warn before the tab closes while an edit is still buffered.
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    const node = target ?? globalThis.window
    const onBeforeUnload = (event: Event): void => {
      event.preventDefault()
      // Older browsers only show the prompt when returnValue is set as well.
      event.returnValue = true
    }
    node.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      node.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [hasUnsavedChanges, target])
}
