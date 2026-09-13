import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'

/**
 * A placeholder is replaced by what the author types (ADR-029).
 *
 * The prompt is not text the author has to select and delete: typing anywhere
 * inside it means "this is what goes here", so the whole directive gives way to
 * the first keystroke. Block placeholders become a paragraph, inline ones become
 * the text itself, which is what each one was standing in for.
 */

const PLACEHOLDER = 'placeholder'

export interface PlaceholderRange {
  readonly from: number
  readonly to: number
  /** A `:::placeholder` stands for a whole section; a `:placeholder[…]` for a phrase. */
  readonly block: boolean
}

function isPlaceholder(node: PMNode): boolean {
  return (
    (node.type.name === 'containerDirective' || node.type.name === 'textDirective') &&
    node.attrs['name'] === PLACEHOLDER
  )
}

/** The innermost placeholder the position sits in, if any. */
export function placeholderAt($pos: ResolvedPos): PlaceholderRange | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (!isPlaceholder(node)) continue
    return {
      from: $pos.before(depth),
      to: $pos.after(depth),
      block: node.type.name === 'containerDirective',
    }
  }
  return null
}

export const placeholderTypingKey = new PluginKey('placeholderTyping')

export const PlaceholderTyping = Extension.create({
  name: 'placeholderTyping',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: placeholderTypingKey,
      props: {
        handleTextInput: (view, from, _to, text) => {
          const { state } = view
          const range = placeholderAt(state.doc.resolve(from))
          if (range === null) return false
          const written = state.schema.text(text)
          const replacement = range.block
            ? nodeType(state.schema, 'paragraph').create(null, written)
            : written
          const tr = state.tr.replaceWith(range.from, range.to, replacement)
          const caret = range.from + replacement.nodeSize
          view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(caret), -1)).scrollIntoView())
          return true
        },
      },
    }),
  ],
})
