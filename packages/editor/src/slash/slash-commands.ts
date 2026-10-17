import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'
import type { Command, Transaction } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'

/**
 * The commands slash items are made of.
 *
 * A block item puts its block where the author is writing: in place of the
 * empty paragraph the slash was typed on, as Notion and Confluence do, or
 * after the line the slash was typed at the end of. Either way the caret
 * lands on the new block's first editable spot. An inline item puts its node
 * at the caret and selects the words in it, so typing replaces them.
 *
 * Nodes are built from the state's own schema, never a module-level one: the
 * editor builds its schema from its extension list, and ProseMirror refuses a
 * node from an equal schema that is not the same object.
 */

export type NodeFactory = (schema: Schema) => PMNode

export interface InsertOptions {
  /** Select the first line of text in the new block, so typing replaces a prompt. */
  readonly selectText?: boolean
}

/** Puts the caret at the first spot after `from` that can hold it, optionally selecting that line. */
function placeCaret(tr: Transaction, from: number, selectText: boolean): void {
  const near = Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)))
  const { $from } = near
  if (selectText && $from.parent.isTextblock && $from.parent.content.size > 0) {
    const start = $from.start()
    tr.setSelection(TextSelection.create(tr.doc, start, start + $from.parent.content.size))
    return
  }
  tr.setSelection(near)
}

/**
 * Inserts a block where the caret is (see the module note). A block with no
 * content of its own, a divider, is followed by an empty paragraph so there
 * is somewhere to keep writing.
 */
export function insertBlock(make: NodeFactory, options: InsertOptions = {}): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const line = $from.parent
    if (!line.isTextblock || $from.depth === 0) return false
    const node = make(state.schema)
    const nodes = node.isLeaf ? [node, nodeType(state.schema, 'paragraph').create()] : [node]
    const parent = $from.node($from.depth - 1)
    const index = $from.index($from.depth - 1)
    const content = Fragment.from(nodes)
    // An empty paragraph is replaced, unless its container needs it there —
    // a list item must open with a paragraph — in which case the block goes
    // after it, as it does after a line with words in it.
    const replacing =
      line.type.name === 'paragraph' &&
      line.content.size === 0 &&
      parent.canReplace(index, index + 1, content)
    if (!replacing && !parent.canReplace(index + 1, index + 1, content)) return false
    const from = replacing ? $from.before() : $from.after()
    const to = replacing ? $from.after() : from
    if (dispatch !== undefined) {
      const tr = state.tr.replaceWith(from, to, nodes)
      placeCaret(tr, node.isLeaf ? from + node.nodeSize + 1 : from + 1, options.selectText === true)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Inserts an inline node at the caret and selects the text inside it. */
export function insertInline(make: NodeFactory): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const node = make(state.schema)
    if (!$from.parent.canReplaceWith($from.index(), $from.indexAfter(), node.type)) return false
    if (dispatch !== undefined) {
      const tr = state.tr.replaceSelectionWith(node, false)
      const start = tr.mapping.map(state.selection.from, -1) + 1
      tr.setSelection(TextSelection.create(tr.doc, start, start + node.content.size))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Types text at the caret, as if the author had. */
export function insertText(text: string): Command {
  return (state, dispatch) => {
    if (!state.selection.$from.parent.inlineContent) return false
    dispatch?.(state.tr.insertText(text).scrollIntoView())
    return true
  }
}

/**
 * An emoji's shortcode at the caret, with the caret after it, where the editor already draws the
 * emoji. When words follow, the caret goes on past a space: the one that is there, or one this adds
 * so the shortcode stands apart. At the end of a line nothing is added, because Markdown writes a
 * line's last space as an entity.
 */
export function insertShortcode(name: string): Command {
  return (state, dispatch) => {
    if (!state.selection.$from.parent.inlineContent) return false
    if (dispatch !== undefined) {
      const tr = state.tr.insertText(`:${name}:`)
      const end = tr.selection.from
      const next = tr.doc.textBetween(end, Math.min(end + 1, tr.doc.content.size))
      if (/^\s$/u.test(next)) tr.setSelection(TextSelection.create(tr.doc, end + 1))
      else if (next !== '') tr.insertText(' ', end)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** The text directive `:name[text]`, which badges, labels and small print all are. */
export function textDirective(name: string, text: string): NodeFactory {
  return (schema) =>
    nodeType(schema, 'textDirective').create({ name, attributes: {} }, schema.text(text))
}

/** The container directive `:::name`, holding the given blocks or one empty paragraph. */
export function containerDirective(
  name: string,
  attributes: Readonly<Record<string, string>>,
  body?: (schema: Schema) => readonly PMNode[],
): NodeFactory {
  return (schema) =>
    nodeType(schema, 'containerDirective').create(
      { name, attributes },
      body === undefined ? paragraph(schema) : body(schema),
    )
}

/**
 * A paragraph, with words in it when given some. An empty one is marked
 * synthetic: it is there because a block must hold one, and if the author
 * leaves it empty it is not written, so `:::callout` saves as `:::callout`.
 */
export function paragraph(schema: Schema, text?: string): PMNode {
  const type = nodeType(schema, 'paragraph')
  return text === undefined || text === ''
    ? type.create({ synthetic: true })
    : type.create(null, schema.text(text))
}

/** The footnote identifiers a document already uses, so a new one does not collide. */
function footnoteIdentifiers(doc: PMNode): ReadonlySet<string> {
  const used = new Set<string>()
  doc.descendants((node) => {
    const identifier = node.attrs['identifier']
    if (node.type.name.startsWith('footnote') && typeof identifier === 'string') {
      used.add(identifier)
    }
  })
  return used
}

/**
 * A footnote: the mark `[^n]` at the caret, numbered after the document's
 * others, and its note at the end of the document with the caret in it, as a
 * word processor does. The note's prompt is selected, so typing replaces it.
 */
export function insertFootnote(prompt: string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const reference = nodeType(state.schema, 'footnoteReference')
    if (!$from.parent.canReplaceWith($from.index(), $from.indexAfter(), reference)) return false
    if (dispatch !== undefined) {
      const used = footnoteIdentifiers(state.doc)
      let number = 1
      while (used.has(String(number))) number += 1
      const identifier = String(number)
      const tr = state.tr.replaceSelectionWith(reference.create({ identifier, label: identifier }))
      const end = tr.doc.content.size
      tr.insert(
        end,
        nodeType(state.schema, 'footnoteDefinition').create(
          { identifier, label: identifier },
          paragraph(state.schema, prompt),
        ),
      )
      placeCaret(tr, end + 1, true)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}
