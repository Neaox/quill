import {
  CHILDREN_DIRECTIVE_NAME,
  childPagesAttributes,
  childPagesFrom,
  TOC_DIRECTIVE_NAME,
  tableOfContentsAttributes,
  tableOfContentsFrom,
} from '@quill/markdown'
import type { ChildPagesBlock, TableOfContents } from '@quill/markdown'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'

/**
 * The navigation blocks in the editor (ADR-056): `::toc` and `::children`
 * are leaf directives, so they are the Markdown package's existing node and
 * round-trip through it byte for byte. These read a node into the block's
 * model with the directive's own parser, so the editor and the reader can
 * never read a block differently, and write a model back as one transaction.
 */

export type NavigationBlockName = typeof TOC_DIRECTIVE_NAME | typeof CHILDREN_DIRECTIVE_NAME

const LEAF = 'leafDirective'

/** The node's name, when it is one of the navigation blocks. */
export function navigationBlockOf(node: PMNode): NavigationBlockName | undefined {
  if (node.type.name !== LEAF) return undefined
  const name = node.attrs['name']
  return name === TOC_DIRECTIVE_NAME || name === CHILDREN_DIRECTIVE_NAME ? name : undefined
}

function attributesOf(node: PMNode): Record<string, string> {
  const attributes: unknown = node.attrs['attributes']
  if (typeof attributes !== 'object' || attributes === null) return {}
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name,
      typeof value === 'string' ? value : '',
    ]),
  )
}

export function tableOfContentsOf(node: PMNode): TableOfContents {
  return tableOfContentsFrom(attributesOf(node), node.textContent)
}

export function childPagesOf(node: PMNode): ChildPagesBlock {
  return childPagesFrom(attributesOf(node), node.textContent)
}

/**
 * Replaces the block at `pos` with the same block holding these options:
 * one transaction, so one undo takes a change back. The attributes it does
 * not own are kept (AGENTS.md rule 7).
 */
export function setNavigationBlock(pos: number, model: TableOfContents | ChildPagesBlock): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    const name = node === null ? undefined : navigationBlockOf(node)
    if (node === null || name === undefined) return false
    const attributes =
      'levels' in model
        ? tableOfContentsAttributes(attributesOf(node), model)
        : childPagesAttributes(attributesOf(node), model)
    const title = model.title?.trim() ?? ''
    const replacement = node.type.create(
      { ...node.attrs, attributes },
      title === '' ? null : state.schema.text(title),
    )
    if (replacement.eq(node)) return false
    // Its own step of undo, however quickly the next setting follows it.
    dispatch?.(closeHistory(state.tr.replaceWith(pos, pos + node.nodeSize, replacement)))
    return true
  }
}

/**
 * Inserts a navigation block on the line the caret is on, with an empty line
 * after it to keep writing on: an empty line is replaced, any other is kept
 * and the block goes after it. The caret lands on the new line.
 */
export function insertNavigationBlock(name: NavigationBlockName): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const line = $from.parent
    if (!line.isTextblock || $from.depth === 0) return false
    const block = nodeType(state.schema, LEAF).create({ name, attributes: {} })
    const after = nodeType(state.schema, 'paragraph').create()
    const parent = $from.node($from.depth - 1)
    const index = $from.index($from.depth - 1)
    const replacing = line.type.name === 'paragraph' && line.content.size === 0
    const nodes = [block, after]
    const from = replacing ? $from.before() : $from.after()
    const to = replacing ? $from.after() : from
    const fits = replacing
      ? parent.canReplaceWith(index, index + 1, block.type) &&
        parent.canReplaceWith(index, index + 1, after.type)
      : parent.canReplaceWith(index + 1, index + 1, block.type)
    if (!fits) return false
    if (dispatch !== undefined) {
      const tr = state.tr.replaceWith(from, to, nodes)
      tr.setSelection(TextSelection.create(tr.doc, from + block.nodeSize + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}
