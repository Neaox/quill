import { CALLOUT_TYPES, DEFAULT_CALLOUT_TYPE, isCalloutType, markerOf } from '@quill/markdown'
import type { CalloutType } from '@quill/markdown'
import { wrapIn } from '@tiptap/pm/commands'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'

import { directiveAttributes, directiveName } from '../schema/directive-attributes.ts'
import { nodeType } from '../schema/node-type.ts'

/**
 * Callouts, as commands on the container directive they are.
 *
 * A callout is not a node of its own: it is `:::callout{type=…}`, a container
 * directive that this module recognises by name. Changing its variant therefore
 * changes one attribute and nothing else, which is what keeps every other
 * attribute and the callout's body exactly as the author left them.
 */

export { CALLOUT_TYPES }

export function calloutLabel(type: CalloutType): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

/** What each variant is for, in the words a picker shows beside its name. */
export const CALLOUT_PURPOSES: Readonly<Record<CalloutType, string>> = {
  note: 'Something to keep in mind',
  info: 'Background the reader may need',
  tip: 'Advice that makes the task easier',
  warning: 'Something that could go wrong',
  important: 'Something the reader must not miss',
  caution: 'Something that could cause harm',
}

export function isCallout(node: PMNode): boolean {
  return directiveName(node) === 'callout'
}

/** The type a callout node is, which is the default for one with no type or an unknown one. */
export function calloutTypeOf(node: PMNode): CalloutType {
  const type = directiveAttributes(node)['type']
  return isCalloutType(type) ? type : DEFAULT_CALLOUT_TYPE
}

export interface CalloutContext {
  /** The position immediately before the callout. */
  readonly pos: number
  readonly node: PMNode
  readonly type: CalloutType
}

/** The innermost callout holding the selection, or the selected callout itself. */
export function calloutAt(state: EditorState): CalloutContext | null {
  const { selection } = state
  if (selection instanceof NodeSelection && isCallout(selection.node)) {
    return { pos: selection.from, node: selection.node, type: calloutTypeOf(selection.node) }
  }
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (isCallout(node)) return { pos: $from.before(depth), node, type: calloutTypeOf(node) }
  }
  return null
}

/** Makes the callout the selection is in a different variant. */
export function setCalloutType(type: CalloutType): Command {
  return (state, dispatch) => {
    const callout = calloutAt(state)
    if (callout === null || callout.type === type) return false
    const attributes = { ...directiveAttributes(callout.node), type }
    dispatch?.(state.tr.setNodeAttribute(callout.pos, 'attributes', attributes))
    return true
  }
}

/** Takes the callout away and keeps what was inside it. */
export const unwrapCallout: Command = (state, dispatch) => {
  const callout = calloutAt(state)
  if (callout === null) return false
  const end = callout.pos + callout.node.nodeSize
  dispatch?.(state.tr.replaceWith(callout.pos, end, callout.node.content).scrollIntoView())
  return true
}

/** Takes the callout away along with what was inside it. */
export const deleteCallout: Command = (state, dispatch) => {
  const callout = calloutAt(state)
  if (callout === null || state.doc.childCount === 1) return false
  const end = callout.pos + callout.node.nodeSize
  dispatch?.(state.tr.delete(callout.pos, end).scrollIntoView())
  return true
}

/**
 * The attributes of a callout made in the editor. It is written as the standard
 * quote, `> [!TIP]`, which GitHub and Obsidian both read and every other parser
 * reads as a quote; Quill's own `:::callout` is for what the quote cannot say, and
 * for the documents that were written with it.
 */
export function newCalloutAttributes(type: CalloutType) {
  return { name: 'callout', attributes: { type }, alert: { marker: markerOf(type), own: false } }
}

/** Puts the blocks the selection covers inside a callout of this variant. */
export function wrapInCallout(type: CalloutType): Command {
  return (state, dispatch, view) =>
    calloutAt(state) === null &&
    wrapIn(nodeType(state.schema, 'containerDirective'), newCalloutAttributes(type))(
      state,
      dispatch,
      view,
    )
}
