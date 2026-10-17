import {
  alertForm,
  alertType,
  isAlertType,
  isCalloutType,
  retypeAlert,
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
 * A callout is written in one of two ways, and the author's choice is kept:
 * a GitHub alert (`> [!WARNING]`), which every Markdown reader shows as a
 * quote, and a `:::callout{type=warning}` directive, which can carry Quill's
 * `info` type and a title of its own. Changing the type changes the type word
 * and nothing else — an alert stays an alert, a directive keeps its attribute
 * block as written — so a switch is a one-word diff and one undo step.
 */

export type CalloutSyntax = 'alert' | 'directive'

export interface CalloutRef {
  readonly node: PMNode
  /** The position before the callout. */
  readonly pos: number
  readonly syntax: CalloutSyntax
  readonly type: CalloutType
  /** The directive's own title, `:::callout[Before you begin]`; undefined when it has none. */
  readonly title: string | undefined
  /** How an alert's marker was written; undefined for a directive. */
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

/** Why a type or a title cannot be given to an alert. */
export const ALERT_LIMITS = {
  info: 'GitHub alerts have no Info type',
  title: 'GitHub alerts have no title; a callout block can have one',
} as const

function stringAttributes(node: PMNode): Readonly<Record<string, string>> {
  const attributes: unknown = node.attrs['attributes']
  if (typeof attributes !== 'object' || attributes === null) return {}
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, value === null ? '' : String(value)]),
  )
}

/** A callout block's title paragraph, `:::callout[Title]`, or undefined when it has none. */
export function labelParagraph(node: PMNode): PMNode | undefined {
  const first = node.firstChild
  return first?.type.name === 'paragraph' && first.attrs['directiveLabel'] === true
    ? first
    : undefined
}

/** The callout a node is, or undefined when it is not one. */
export function calloutOf(node: PMNode, pos: number): CalloutRef | undefined {
  if (node.type.name === 'blockquote') {
    const form = alertForm(node.attrs['alert'])
    if (form === undefined) return undefined
    return { node, pos, syntax: 'alert', type: alertType(form), title: undefined, alert: form }
  }
  if (node.type.name !== 'containerDirective' || node.attrs['name'] !== 'callout') return undefined
  const type = stringAttributes(node)['type']
  const title = labelParagraph(node)?.textContent
  return {
    node,
    pos,
    syntax: 'directive',
    type: isCalloutType(type) ? type : 'note',
    title: title === undefined || title === '' ? undefined : title,
  }
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
    const node = $pos.node(depth)
    if (node.type.name === 'blockquote') {
      return node.attrs['alert'] === null ? $pos.before(depth) : undefined
    }
  }
  return undefined
}

/** Why a callout cannot take a type, or undefined when it can. */
export function typeUnavailable(callout: CalloutRef, type: CalloutType): string | undefined {
  return callout.syntax === 'alert' && !isAlertType(type) ? ALERT_LIMITS.info : undefined
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
    const { node, alert } = callout
    if (alert !== undefined) {
      if (!isAlertType(type)) return false
      dispatch?.(state.tr.setNodeAttribute(pos, 'alert', retypeAlert(alert, type)))
      return true
    }
    if (dispatch === undefined) return true
    const next = withAttribute(stringAttributes(node), sourceFormOf(node), 'type', type)
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
 * Gives a directive callout a title of its own, or takes it away with an
 * empty one. An alert cannot have one: GitHub would stop reading it as one.
 */
export function setCalloutTitle(pos: number, title: string): Command {
  return (state, dispatch) => {
    const callout = calloutStarting(state, pos)
    if (callout === undefined || callout.syntax !== 'directive') return false
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

/** A plain quote becomes a callout, as a GitHub alert: it is still a quote to every reader. */
export function quoteToCallout(pos: number, type: CalloutType = 'note'): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (node?.type.name !== 'blockquote' || node.attrs['alert'] !== null) return false
    if (!isAlertType(type)) return false
    dispatch?.(
      state.tr.setNodeAttribute(pos, 'alert', {
        marker: `[!${type.toUpperCase()}]\n`,
        alone: false,
      }),
    )
    return true
  }
}

/**
 * A callout becomes a plain quote, its words kept. An alert drops its marker;
 * a directive's title, if it had one, becomes the quote's first line.
 */
export function calloutToQuote(pos: number): Command {
  return (state, dispatch) => {
    const callout = calloutStarting(state, pos)
    if (callout === undefined) return false
    if (dispatch === undefined) return true
    const { node } = callout
    if (callout.syntax === 'alert') {
      dispatch(state.tr.setNodeAttribute(pos, 'alert', null))
      return true
    }
    const content: PMNode[] = []
    node.forEach((child) => {
      const isLabel = child.type.name === 'paragraph' && child.attrs['directiveLabel'] === true
      content.push(
        isLabel
          ? child.type.create({ ...child.attrs, directiveLabel: null }, child.content)
          : child,
      )
    })
    const quote = nodeType(state.schema, 'blockquote').create(
      { layout: node.attrs['layout'] },
      Fragment.from(content),
    )
    dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, quote))
    return true
  }
}
