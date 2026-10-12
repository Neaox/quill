import { toggleMark } from '@tiptap/pm/commands'
import type { Command, EditorState } from '@tiptap/pm/state'

import { markType } from '../schema/node-type.ts'

/**
 * The inline marks a writer toggles, as one list.
 *
 * The keyboard map, the formatting toolbar, and the context menu all offer these
 * four; defining them once is what stops a shortcut shown on a button from
 * drifting from the one that is bound.
 */

export interface InlineMark {
  readonly name: 'bold' | 'italic' | 'strike' | 'code'
  readonly label: string
  /** In ProseMirror's key syntax; `Mod` is Command on a Mac and Control elsewhere. */
  readonly key: string
}

export const INLINE_MARKS: readonly InlineMark[] = [
  { name: 'bold', label: 'Bold', key: 'Mod-b' },
  { name: 'italic', label: 'Italic', key: 'Mod-i' },
  { name: 'strike', label: 'Strikethrough', key: 'Mod-Shift-x' },
  { name: 'code', label: 'Code', key: 'Mod-e' },
]

export function toggleInlineMark(name: InlineMark['name']): Command {
  return (state, dispatch, view) => toggleMark(markType(state.schema, name))(state, dispatch, view)
}

/**
 * Takes every mark off the selection (or off what the next typed character would
 * be, for a caret), as "Clear formatting" does everywhere it is offered. A link is
 * not formatting: it says where the words go, and is removed as a link is.
 */
export const clearFormatting: Command = (state, dispatch) => {
  const types = INLINE_MARKS.map((mark) => markType(state.schema, mark.name))
  const { from, to, empty, $from } = state.selection
  if (empty) {
    const active = state.storedMarks ?? $from.marks()
    if (!active.some((mark) => types.includes(mark.type))) return false
    dispatch?.(state.tr.setStoredMarks(active.filter((mark) => !types.includes(mark.type))))
    return true
  }
  if (!types.some((type) => state.doc.rangeHasMark(from, to, type))) return false
  if (dispatch !== undefined) {
    const tr = state.tr
    for (const type of types) tr.removeMark(from, to, type)
    dispatch(tr)
  }
  return true
}

/** Whether the mark applies to the whole selection, or to the caret's next character. */
export function isMarkActive(state: EditorState, name: string): boolean {
  const type = markType(state.schema, name)
  const { from, to, empty, $from } = state.selection
  return empty
    ? type.isInSet(state.storedMarks ?? $from.marks()) !== undefined
    : state.doc.rangeHasMark(from, to, type)
}

const APPLE = /Mac|iPhone|iPad|iPod/

const ARROWS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

/** A key binding as a reader of this platform writes it: `⌘B` on a Mac, `Ctrl+B` elsewhere. */
export function describeKey(key: string, platform: string): string {
  const mac = APPLE.test(platform)
  const parts = key.split('-').map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
    if (part === 'Shift') return mac ? '⇧' : 'Shift'
    if (part === 'Alt') return mac ? '⌥' : 'Alt'
    return ARROWS[part] ?? (part.length === 1 ? part.toUpperCase() : part)
  })
  return mac ? parts.join('') : parts.join('+')
}

/** A key binding as the reader of this browser writes it. */
export function describeShortcut(key: string): string {
  return describeKey(key, navigator.platform)
}
