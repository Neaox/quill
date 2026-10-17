import { toggleMark } from '@tiptap/pm/commands'
import type { MarkType, Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

import { markType, nodeType } from '../schema/node-type.ts'

/**
 * Formatting the words a writer has selected, as commands.
 *
 * The selection toolbar, the context menu and the keymap all run these, so
 * a mark means the same thing however it was asked for, and each is one undo
 * step. Bold, italic, strikethrough and inline code are marks; small print
 * and a badge are text directives (`:small[…]`, `:badge[…]`), which wrap the
 * words rather than mark them, so they are toggled by wrapping and
 * unwrapping.
 */

/** The marks the toolbar toggles, by their schema names. */
export const FORMAT_MARKS = ['bold', 'italic', 'strike', 'code'] as const

export type FormatMark = (typeof FORMAT_MARKS)[number]

/** The text directives the toolbar toggles. */
export const FORMAT_DIRECTIVES = ['small', 'badge'] as const

export type FormatDirective = (typeof FORMAT_DIRECTIVES)[number]

/** Whether every piece of text in the selection carries the mark; at a caret, whether typing would. */
export function markActive(state: EditorState, name: FormatMark | 'link'): boolean {
  const type = markType(state.schema, name)
  const { from, to, empty, $from } = state.selection
  if (empty) return type.isInSet(state.storedMarks ?? $from.marks()) !== undefined
  let text = false
  let all = true
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    text = true
    if (type.isInSet(node.marks) === undefined) all = false
    return false
  })
  return text && all
}

export function toggleFormatMark(name: FormatMark): Command {
  return (state, dispatch, view) => toggleMark(markType(state.schema, name))(state, dispatch, view)
}

/** The text directive both ends of the selection are inside, when they are inside the same one. */
export function directiveAround(
  state: EditorState,
  name: FormatDirective,
): { readonly node: PMNode; readonly pos: number } | undefined {
  const { $from, $to } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'textDirective' && node.attrs['name'] === name) {
      const pos = $from.before(depth)
      return $to.pos <= pos + node.nodeSize - 1 ? { node, pos } : undefined
    }
  }
  return undefined
}

export function directiveActive(state: EditorState, name: FormatDirective): boolean {
  return directiveAround(state, name) !== undefined
}

/** Whether a text directive can wrap the selection: words in one line, where inline content goes. */
function wrappable($from: ResolvedPos, $to: ResolvedPos, empty: boolean): boolean {
  return (
    !empty && $from.sameParent($to) && $from.parent.inlineContent && !$from.parent.type.spec.code
  )
}

/**
 * Wraps the selected words in `:small[…]` or `:badge[…]`, or unwraps the one
 * the selection is in. The words stay selected either way, so a second press
 * undoes the first.
 */
export function toggleFormatDirective(name: FormatDirective): Command {
  return (state, dispatch) => {
    const around = directiveAround(state, name)
    if (around !== undefined) {
      if (dispatch !== undefined) {
        const { node, pos } = around
        const tr = state.tr.replaceWith(pos, pos + node.nodeSize, node.content)
        tr.setSelection(TextSelection.create(tr.doc, pos, pos + node.content.size))
        dispatch(tr.scrollIntoView())
      }
      return true
    }
    const { $from, $to, from, to, empty } = state.selection
    if (!wrappable($from, $to, empty)) return false
    const type = nodeType(state.schema, 'textDirective')
    const content = state.doc.slice(from, to).content
    const wrapper = type.create({ name, attributes: {} }, content)
    if (dispatch !== undefined) {
      const tr = state.tr.replaceWith(from, to, wrapper)
      tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + content.size))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** The marks clearing formatting takes off: a link is content, not formatting, so it stays. */
function formattingMarks(state: EditorState): readonly MarkType[] {
  return FORMAT_MARKS.map((name) => markType(state.schema, name))
}

/** Every small print and badge wholly inside a range, innermost last, so unwrapping keeps positions valid. */
function directivesIn(doc: PMNode, from: number, to: number): { node: PMNode; pos: number }[] {
  const found: { node: PMNode; pos: number }[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    const name = node.attrs['name']
    if (
      node.type.name === 'textDirective' &&
      (FORMAT_DIRECTIVES as readonly unknown[]).includes(name) &&
      pos >= from &&
      pos + node.nodeSize <= to
    ) {
      found.push({ node, pos })
    }
    return true
  })
  return found.toReversed()
}

/** Whether the selection carries any formatting clearing would take off. */
export function hasFormatting(state: EditorState): boolean {
  const { from, to, empty } = state.selection
  if (empty) return false
  const marks = formattingMarks(state)
  const marked = marks.some((type) => state.doc.rangeHasMark(from, to, type))
  return marked || directivesIn(state.doc, from, to).length > 0 || directiveIsAround(state)
}

function directiveIsAround(state: EditorState): boolean {
  return FORMAT_DIRECTIVES.some((name) => directiveActive(state, name))
}

/**
 * Takes the formatting off the selected words: the marks, and the small print
 * and badges they are wrapped in. Links stay. The words stay selected.
 */
export const clearFormatting: Command = (state, dispatch) => {
  if (!hasFormatting(state)) return false
  if (dispatch === undefined) return true
  const { from, to } = state.selection
  let tr: Transaction = state.tr
  for (const type of formattingMarks(state)) tr = tr.removeMark(from, to, type)
  for (const { node, pos } of directivesIn(tr.doc, from, to)) {
    tr = tr.replaceWith(pos, pos + node.nodeSize, node.content)
  }
  for (const name of FORMAT_DIRECTIVES) {
    const around = directiveAround(state.apply(tr), name)
    if (around !== undefined) {
      tr = tr.replaceWith(around.pos, around.pos + around.node.nodeSize, around.node.content)
    }
  }
  const start = tr.mapping.map(from, -1)
  const end = tr.mapping.map(to, 1)
  dispatch(tr.setSelection(TextSelection.create(tr.doc, start, end)))
  return true
}
