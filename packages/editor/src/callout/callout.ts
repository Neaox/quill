import {
  isCalloutType,
  markerName,
  markerOf,
  markerType,
  readAlertForm,
  withAttribute,
} from '@quill/markdown'
import type { AlertForm, CalloutType, WithAttribute } from '@quill/markdown'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'

/**
 * Callouts as the editor changes them.
 *
 * A callout is a `:::callout` container directive in the editor, whichever way
 * it is written, and the author's choice of way is kept: as a quote (GitHub's
 * `> [!WARNING]`, Obsidian's `> [!tip] Title`, of any kind Obsidian has or the
 * author made up), which every Markdown reader shows as a quote and whose
 * marker the node carries as its `alert` form, or as `:::callout{type=warning}`.
 * Changing the type changes the type and nothing else — a quote stays a quote,
 * its marker in the case it was typed, and a directive keeps its attribute
 * block as written — so a switch is a one-word diff and one undo step, and
 * switching back gives the marker back exactly as it was.
 */

export type CalloutSyntax = 'alert' | 'directive'

export interface CalloutRef {
  readonly node: PMNode
  /** The position before the callout. */
  readonly pos: number
  readonly syntax: CalloutSyntax
  /** The type it is drawn as. */
  readonly type: CalloutType
  /** What its kind is called: the type's label, or the kind the author wrote (`Faq`). */
  readonly name: string
  /** Its own title, `:::callout[Before you begin]` or `> [!tip] Before you begin`. */
  readonly title: string | undefined
  /** How a quote's marker was written; undefined for a directive. */
  readonly alert?: AlertForm | undefined
}

export const CALLOUT_LABELS: Readonly<Record<CalloutType, string>> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

/** A kind the author wrote, as a label: `faq` is `Faq`. */
function asLabel(kind: string): string {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`
}

function stringAttributes(node: PMNode): Readonly<Record<string, string>> {
  const attributes: unknown = node.attrs['attributes']
  if (typeof attributes !== 'object' || attributes === null) return {}
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, value === null ? '' : String(value)]),
  )
}

/** A callout's title paragraph, `:::callout[Title]`, or undefined when it has none. */
export function labelParagraph(node: PMNode): PMNode | undefined {
  const first = node.firstChild
  return first?.type.name === 'paragraph' && first.attrs['directiveLabel'] === true
    ? first
    : undefined
}

/** The callout a node is, or undefined when it is not one. */
export function calloutOf(node: PMNode, pos: number): CalloutRef | undefined {
  if (node.type.name !== 'containerDirective' || node.attrs['name'] !== 'callout') return undefined
  const written = stringAttributes(node)['type']
  const type = isCalloutType(written) ? written : 'note'
  const label = labelParagraph(node)?.textContent
  const title = label === undefined || label === '' ? undefined : label
  const alert = readAlertForm(node.attrs['alert'])
  if (alert === undefined) {
    return { node, pos, syntax: 'directive', type, name: CALLOUT_LABELS[type], title }
  }
  // The kind is said as it was written for as long as it is the type it was read as.
  const name =
    markerType(alert.marker) === type ? asLabel(markerName(alert.marker)) : CALLOUT_LABELS[type]
  return { node, pos, syntax: 'alert', type, name, title, alert }
}

/** The innermost callout around a position. */
export function calloutAt(state: EditorState, at = state.selection.from): CalloutRef | undefined {
  const $pos = state.doc.resolve(at)
  const after = $pos.nodeAfter
  if (after !== null) {
    const own = calloutOf(after, at)
    if (own !== undefined) return own
  }
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const found = calloutOf($pos.node(depth), $pos.before(depth))
    if (found !== undefined) return found
  }
  return undefined
}

/** The innermost plain quote around a position, which can become a callout. */
export function quoteAt(state: EditorState, at = state.selection.from): number | undefined {
  const $pos = state.doc.resolve(at)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'blockquote') return $pos.before(depth)
  }
  return undefined
}

function calloutStarting(state: EditorState, pos: number): CalloutRef | undefined {
  const node = state.doc.nodeAt(pos)
  return node === null ? undefined : calloutOf(node, pos)
}

function sourceFormOf(node: PMNode): WithAttribute['sourceForm'] {
  // The schema's default is null: a node read from Markdown with nothing to keep.
  return node.attrs['sourceForm']
}

/** Changes the callout at `pos` to `type`, in the syntax it was written in. */
export function setCalloutType(pos: number, type: CalloutType): Command {
  return (state, dispatch) => {
    const callout = calloutStarting(state, pos)
    if (callout === undefined || callout.type === type) return false
    if (dispatch === undefined) return true
    const { node, alert } = callout
    // A quote's marker is written from its type (`to-mdast.ts`), and its form is
    // kept, so the marker comes back as it was typed when the type does.
    const next =
      alert === undefined
        ? withAttribute(stringAttributes(node), sourceFormOf(node), 'type', type)
        : { attributes: { type }, sourceForm: sourceFormOf(node) }
    dispatch(
      state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        attributes: next.attributes,
        sourceForm: next.sourceForm,
      }),
    )
    return true
  }
}

/**
 * Gives a callout a title of its own, or takes it away with an empty one. A
 * quote's title is written after its marker, as Obsidian writes it.
 */
export function setCalloutTitle(pos: number, title: string): Command {
  return (state, dispatch) => {
    const callout = calloutStarting(state, pos)
    if (callout === undefined) return false
    const words = title.trim()
    if ((callout.title ?? '') === words) return false
    if (dispatch === undefined) return true
    // The title is the first line of the body when there is one: replaced, or removed.
    const titleSize = labelParagraph(callout.node)?.nodeSize ?? 0
    const start = pos + 1
    const tr =
      words === ''
        ? state.tr.delete(start, start + titleSize)
        : state.tr.replaceWith(
            start,
            start + titleSize,
            nodeType(state.schema, 'paragraph').create(
              { directiveLabel: true },
              state.schema.text(words),
            ),
          )
    dispatch(tr)
    return true
  }
}

/**
 * A plain quote becomes a callout, written as the quote GitHub and Obsidian
 * read (`> [!NOTE]`): it is still a quote to every other reader.
 */
export function quoteToCallout(pos: number, type: CalloutType = 'note'): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (node?.type.name !== 'blockquote') return false
    if (dispatch === undefined) return true
    const callout = nodeType(state.schema, 'containerDirective').create(
      {
        name: 'callout',
        attributes: { type },
        alert: { marker: markerOf(type), own: false },
        layout: node.attrs['layout'],
      },
      node.content,
    )
    dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, callout))
    return true
  }
}

/** A callout becomes a plain quote, its words kept: its title, if it had one, its first line. */
export function calloutToQuote(pos: number): Command {
  return (state, dispatch) => {
    const callout = calloutStarting(state, pos)
    if (callout === undefined) return false
    if (dispatch === undefined) return true
    const content: PMNode[] = []
    callout.node.forEach((child) => {
      const isLabel = child.type.name === 'paragraph' && child.attrs['directiveLabel'] === true
      content.push(
        isLabel
          ? child.type.create({ ...child.attrs, directiveLabel: null }, child.content)
          : child,
      )
    })
    const quote = nodeType(state.schema, 'blockquote').create(
      { layout: callout.node.attrs['layout'] },
      Fragment.from(content),
    )
    dispatch(state.tr.replaceWith(pos, pos + callout.node.nodeSize, quote))
    return true
  }
}
