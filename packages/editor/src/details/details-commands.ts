import { Fragment } from '@tiptap/pm/model'
import { omit } from 'remeda'
import type { Node as PMNode, ResolvedPos, Schema } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'
import { paragraph } from '../slash/slash-commands.ts'

/**
 * What can be done to a details in the editor (ADR-048), as ProseMirror
 * commands: one transaction each, so each is one step of undo.
 *
 * A details is a summary line and a body. The keys an author reaches for
 * work the way Confluence's expand and Notion's toggle work: Enter in the
 * summary goes into the body; Backspace at the start of the summary, or in a
 * body left empty, takes the details away and keeps its words; Enter on an
 * empty last line of the body leaves it. Opening and closing it while
 * writing is the view's (`details-folds.ts`) and never changes the document;
 * "Open by default" is the document's own `open` and does.
 */

/** A new details: an empty summary, where the caret goes, and an empty body. */
export function createDetailsNode(schema: Schema, summary = ''): PMNode {
  return nodeType(schema, 'details').create(null, [
    nodeType(schema, 'detailsSummary').create(null, summary === '' ? null : schema.text(summary)),
    paragraph(schema),
  ])
}

/** A new accordion of two details, the caret in the first one's summary. */
export function createAccordionNode(schema: Schema): PMNode {
  return nodeType(schema, 'containerDirective').create({ name: 'accordion', attributes: {} }, [
    createDetailsNode(schema),
    createDetailsNode(schema),
  ])
}

/** The details at `pos`, if that is where one is. */
function detailsAt(doc: PMNode, pos: number): PMNode | undefined {
  const node = doc.nodeAt(pos)
  return node?.type.name === 'details' ? node : undefined
}

function attributesOf(node: PMNode): Readonly<Record<string, unknown>> {
  const attributes: unknown = node.attrs['attributes']
  return typeof attributes === 'object' && attributes !== null
    ? Object.fromEntries(Object.entries(attributes))
    : {}
}

/** Whether a details opens for a reader by default: its `open` attribute, as a directive reads one. */
export function isOpenByDefault(node: PMNode): boolean {
  const attributes = attributesOf(node)
  return Object.hasOwn(attributes, 'open') && attributes['open'] !== 'false'
}

/**
 * Makes the details at `pos` open, or closed, for a reader by default. The
 * other attributes keep their places, so a directive's attribute block is
 * rewritten only where it changed.
 */
export function setOpenByDefault(pos: number, open: boolean): Command {
  return (state, dispatch) => {
    const details = detailsAt(state.doc, pos)
    if (details === undefined || isOpenByDefault(details) === open) return false
    const rest = omit(attributesOf(details), ['open'])
    dispatch?.(state.tr.setNodeAttribute(pos, 'attributes', open ? { ...rest, open: '' } : rest))
    return true
  }
}

/** Where a caret is in a details, if it is in one: the details, its position, and the depth of it. */
interface InDetails {
  readonly details: PMNode
  readonly pos: number
  readonly depth: number
}

function enclosingDetails($pos: ResolvedPos): InDetails | undefined {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'details') return { details: node, pos: $pos.before(depth), depth }
  }
  return undefined
}

/** The details' summary words as a paragraph, and its body without the empty line it must hold. */
function unwrapped(schema: Schema, details: PMNode): PMNode[] {
  const blocks: PMNode[] = []
  details.forEach((child, _offset, index) => {
    if (index === 0) {
      blocks.push(nodeType(schema, 'paragraph').create(null, child.content))
      return
    }
    const synthetic = child.type.name === 'paragraph' && child.content.size === 0
    if (!synthetic) blocks.push(child)
  })
  return blocks
}

/** Replaces the details with its words: the summary as a paragraph, then its body. */
function unwrap(found: InDetails, caretAtEnd: boolean): Command {
  return (state, dispatch) => {
    const { details, pos } = found
    const blocks = unwrapped(state.schema, details)
    if (dispatch !== undefined) {
      const tr = state.tr.replaceWith(pos, pos + details.nodeSize, Fragment.from(blocks))
      const at = pos + 1 + (caretAtEnd ? details.child(0).content.size : 0)
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at)).scrollIntoView())
    }
    return true
  }
}

/**
 * Enter in the summary goes into the body. The words after the caret, if
 * any, go with it, as the start of the body's first line.
 */
export const enterFromSummary: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'detailsSummary') return false
  const found = enclosingDetails($from)
  if (found === undefined) return false
  if (dispatch !== undefined) {
    // A line does not start with the space the caret was in front of.
    const rest = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '￼')
    const spaces = rest.length - rest.trimStart().length
    const after = $from.parent.content.cut($from.parentOffset + spaces)
    const bodyStart = $from.after()
    const first = found.details.maybeChild(1)
    const tr = state.tr.delete($from.pos, $from.end())
    const start = tr.mapping.map(bodyStart)
    const reuse = after.size === 0 && first?.type.name === 'paragraph' && first.content.size === 0
    if (!reuse) tr.insert(start, nodeType(state.schema, 'paragraph').create(null, after))
    dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)).scrollIntoView())
  }
  return true
}

/**
 * Backspace at the start of a details' summary, or at the start of a body
 * that holds nothing but an empty line, takes the details away and keeps its
 * words. At the start of a body with something in it, the caret goes back to
 * the end of the summary rather than joining the two.
 */
export const backspaceInDetails: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0) return false
  const found = enclosingDetails($from)
  if (found === undefined) return false
  if ($from.parent.type.name === 'detailsSummary') return unwrap(found, false)(state, dispatch)
  // Only the first line of the body, directly in the details.
  if ($from.depth !== found.depth + 1 || $from.index(found.depth) !== 1) return false
  const { details } = found
  const bodyIsEmpty = details.childCount === 2 && $from.parent.content.size === 0
  if (bodyIsEmpty) return unwrap(found, true)(state, dispatch)
  if (dispatch !== undefined) {
    const summaryEnd = found.pos + 1 + details.child(0).nodeSize - 1
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, summaryEnd)))
  }
  return true
}

/** Enter on an empty last line of a body with more in it leaves the details, as it leaves a quote. */
export const exitDetails: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0)
    return false
  const found = enclosingDetails($from)
  if (found === undefined || $from.depth !== found.depth + 1) return false
  const { details, pos, depth } = found
  const index = $from.index(depth)
  if (index !== details.childCount - 1 || details.childCount < 3) return false
  if (dispatch !== undefined) {
    const line = $from.before()
    const tr = state.tr.delete(line, line + $from.parent.nodeSize)
    const after = tr.mapping.map(pos + details.nodeSize)
    tr.insert(after, nodeType(state.schema, 'paragraph').create())
    dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView())
  }
  return true
}
