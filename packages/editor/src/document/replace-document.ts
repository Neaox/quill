import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Makes the editor hold `next`, by replacing only the stretch of the document that is
 * different: the blocks before and after it are left as they are, so a caret or a
 * selection outside the change stays where it was, and the whole is one step in the undo
 * history. It is the idiom for setting content under an author's hands, not a reset.
 */
export function replaceDocument(editor: Editor, next: PMNode): void {
  const { doc, tr } = editor.state
  const start = doc.content.findDiffStart(next.content)
  const end = doc.content.findDiffEnd(next.content)
  if (start === null || end === null) return

  let { a: endOfOld, b: endOfNew } = end
  // The two ends can cross when what changed is a repeat of its neighbour.
  const overlap = start - Math.min(endOfOld, endOfNew)
  if (overlap > 0) {
    endOfOld += overlap
    endOfNew += overlap
  }
  editor.view.dispatch(tr.replace(start, endOfOld, next.slice(start, endOfNew)))
}
