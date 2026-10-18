import { readFrontMatter, writeFrontMatter } from '@quill/markdown'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory, redo, undo } from '@tiptap/pm/history'
import type { Command, Transaction } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'

import { nodeType } from '../schema/node-type.ts'

/**
 * Front matter, out of the writing surface (ADR-005).
 *
 * The node stays in the document — it is what carries the YAML source, and
 * with it the comments, the key order, and every field this release has never
 * heard of — but it is not something to type at, so it is not drawn. What the
 * author edits instead is the properties strip above the body, which writes
 * back through `applyFrontMatter` below.
 *
 * The element is `hidden` rather than removed, because a node view must return
 * a DOM node for the position ProseMirror maps to it; hidden is the honest
 * version of "this block has no presentation".
 */
export class FrontMatterNodeView implements NodeView {
  readonly dom: HTMLElement

  constructor() {
    this.dom = document.createElement('div')
    this.dom.className = 'front-matter-node'
    this.dom.hidden = true
    this.dom.contentEditable = 'false'
    this.dom.setAttribute('aria-hidden', 'true')
  }

  /** Nothing inside it is ProseMirror's to redraw or to hear about. */
  stopEvent(): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }
}

const withView: Partial<NodeConfig> = {
  addNodeView: () => () => new FrontMatterNodeView(),
}

/** Takes the Markdown package's `frontMatter` node out of the writing surface. */
export function withFrontMatterView(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'frontMatter'
      ? extension.extend(withView)
      : extension,
  )
}

/** Where the document's front matter block is, and what it says. */
export function frontMatterPosition(
  doc: PMNode,
): { readonly pos: number; readonly node: PMNode } | undefined {
  let found: { readonly pos: number; readonly node: PMNode } | undefined
  doc.forEach((node, offset) => {
    if (found === undefined && node.type.name === 'frontMatter') found = { pos: offset, node }
  })
  return found
}

/** The record the document's front matter block currently holds, as YAML. */
export function frontMatterSource(doc: PMNode): string | undefined {
  const found = frontMatterPosition(doc)
  if (found === undefined) return undefined
  const value = found.node.attrs['value']
  return typeof value === 'string' ? value : undefined
}

/**
 * The record the block holds, or `fallback` when the document has no block.
 *
 * While a document is being edited its front matter block is the source of
 * truth: a property change is a transaction on it, so an undo of that change
 * is too, and whoever keeps the record beside the tree (the draft envelope)
 * follows the block rather than the other way round. With no block, nothing
 * has been written yet and the record the document came with still stands.
 */
export function frontMatterRecord(
  doc: PMNode,
  fallback: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const source = frontMatterSource(doc)
  return source === undefined ? fallback : readFrontMatter(source).value
}

/**
 * The step a property change is: one of its own in the undo history, never
 * merged with typing that happened a moment before, so Ctrl+Z undoes exactly
 * the change the author made in the properties line.
 */
function asOwnStep(tr: Transaction): Transaction {
  return closeHistory(tr)
}

/** Undo and redo of the document's history, for a control outside the writing surface. */
export const undoEdit: Command = undo
export const redoEdit: Command = redo

/**
 * Puts YAML on the front matter block exactly as written: the power user's
 * edit, comments and quoting included. A document with no block gets one.
 */
export function applyFrontMatterSource(yaml: string): Command {
  return (state, dispatch) => {
    const found = frontMatterPosition(state.doc)
    if (found === undefined) {
      if (yaml.trim().length === 0) return false
      const node = nodeType(state.schema, 'frontMatter').create({ value: yaml })
      dispatch?.(asOwnStep(state.tr.insert(0, node)))
      return true
    }
    if (yaml === frontMatterSource(state.doc)) return false
    dispatch?.(asOwnStep(state.tr.setNodeAttribute(found.pos, 'value', yaml)))
    return true
  }
}

/**
 * Writes a front matter record onto the document's front matter block.
 *
 * The YAML is produced by `writeFrontMatter`, which edits the block the author's
 * document already has rather than re-rendering it: a key that did not change
 * keeps its quoting, its comment, and its place (ADR-002). A document with no
 * block at all gets one, at the top, where front matter is.
 */
export function applyFrontMatter(value: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const found = frontMatterPosition(state.doc)
    const source = frontMatterSource(state.doc)
    const yaml = writeFrontMatter(value, source) ?? ''

    if (found === undefined) {
      if (yaml.length === 0) return false
      const node = nodeType(state.schema, 'frontMatter').create({ value: yaml })
      dispatch?.(asOwnStep(state.tr.insert(0, node)))
      return true
    }

    if (yaml === source) return false
    dispatch?.(asOwnStep(state.tr.setNodeAttribute(found.pos, 'value', yaml)))
    return true
  }
}
