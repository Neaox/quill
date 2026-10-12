/**
 * The keys of the find bar's fields, as VS Code has them: Enter and Shift+Enter step through the
 * matches, Enter in the replace field replaces and Ctrl+Alt+Enter replaces all, Escape closes, and
 * Alt with a letter toggles an option, and the keys that open find work again from inside it. A pure function of the event, so it is tested without a field.
 */

export type FindBarCommand =
  | 'next'
  | 'previous'
  | 'replace'
  | 'replace-all'
  | 'close'
  | 'show-find'
  | 'show-replace'
  | 'toggle-case'
  | 'toggle-word'
  | 'toggle-regex'
  | 'toggle-preserve-case'
  | 'toggle-selection'

export type BarKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'
>

/**
 * The options by the key that toggles them. The key's place (`code`) is asked, not what it types:
 * with Alt held a Mac types `ç` for C.
 */
const TOGGLES: Readonly<Record<string, FindBarCommand>> = {
  KeyC: 'toggle-case',
  KeyW: 'toggle-word',
  KeyR: 'toggle-regex',
  KeyP: 'toggle-preserve-case',
  KeyL: 'toggle-selection',
}

export function barCommandFor(
  event: BarKeyEvent,
  field: 'find' | 'replace',
): FindBarCommand | undefined {
  const { key, code, shiftKey, altKey, ctrlKey, metaKey } = event
  if (key === 'Escape') return 'close'
  // The keys that open find from the document work from inside the bar too, which has the focus.
  if ((ctrlKey || metaKey) && !shiftKey) {
    if (code === 'KeyF') return altKey ? 'show-replace' : 'show-find'
    if (code === 'KeyH' && !altKey) return 'show-replace'
  }
  if (key === 'Enter') {
    if (field === 'replace') {
      if ((ctrlKey || metaKey) && altKey) return 'replace-all'
      return ctrlKey || metaKey || altKey || shiftKey ? undefined : 'replace'
    }
    if (ctrlKey || metaKey || altKey) return undefined
    return shiftKey ? 'previous' : 'next'
  }
  return altKey && !ctrlKey && !metaKey && !shiftKey ? TOGGLES[code] : undefined
}
