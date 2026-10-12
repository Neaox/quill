import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * What a double click selects: the word.
 *
 * Windows selects the word and the space after it, and so does a browser that
 * follows it, which is where a word processor's habit comes from. In a rich text
 * editor it is a fault: bold the word and the space after it is bold, link it and
 * the space is a link. Mac and every other editor on the web select the word, so
 * the space is let go of once the browser has made its selection.
 */

const TRAILING_SPACE = /\s+$/u

/**
 * The selection without the whitespace it ends in, or null when it has none or is
 * not a word to begin with: a caret, a selection that is only space, or one that
 * runs across blocks.
 */
export function trimmedWordSelection(state: EditorState): TextSelection | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || selection.empty) return null
  if (!selection.$from.sameParent(selection.$to)) return null
  const selected = state.doc.textBetween(selection.from, selection.to)
  const trailing = TRAILING_SPACE.exec(selected)?.[0].length ?? 0
  if (trailing === 0 || trailing === selected.length) return null
  return TextSelection.create(state.doc, selection.from, selection.to - trailing)
}

/**
 * Trims the selection a double click has made. The browser makes it after the click
 * event, so it is looked at on the next turn, when it is the editor's state.
 */
export function trimAfterDoubleClick(view: Pick<EditorView, 'state' | 'dispatch'>): void {
  setTimeout(() => {
    const trimmed = trimmedWordSelection(view.state)
    if (trimmed !== null) view.dispatch(view.state.tr.setSelection(trimmed))
  }, 0)
}

export function createWordSelectionPlugin(): Plugin {
  return new Plugin({
    props: {
      // False: the browser's selection stands; this only takes the space off its end.
      handleDoubleClick: (view) => {
        trimAfterDoubleClick(view)
        return false
      },
    },
  })
}

export const WordSelection = Extension.create({
  name: 'wordSelection',
  addProseMirrorPlugins: () => [createWordSelectionPlugin()],
})
