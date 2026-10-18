import { UNCHOSEN, effectiveDisplay, isBlockDisplay, linkDirective } from '@quill/markdown'
import type { Link, LinkChoice, LinkDisplay } from '@quill/markdown'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

import { linkAt } from '../format/links.ts'
import { linkDefaultDisplayOf } from './link-default-display.ts'
import { embedHintFor } from './link-embeds.ts'
import { markType, nodeType } from '../schema/node-type.ts'
import { directiveAttributes, directiveName } from '../schema/directive-attributes.ts'

/**
 * How a link is shown, as the author sees and changes it (ADR-042,
 * "Authoring surface").
 *
 * A link in a document is one of three things, and this is the one place that
 * knows all three: an ordinary Markdown link (a `link` mark), an inline
 * `:link[…]` directive (a text directive node), and a `::link{…}` card (a leaf
 * directive node). The author sees one thing, a link with a display, and these
 * commands move it between the three without ever losing its address or the
 * author's own words.
 *
 * The directive's attribute rules (what is written, in which order, what an
 * unknown attribute does) are `@quill/markdown`'s `linkDirective`, used here as
 * it is: the editor parses a node through it and writes the answer back through
 * it, so the file an edit produces is the file the renderer reads.
 */

export type LinkTarget =
  | {
      readonly form: 'mark'
      readonly from: number
      readonly to: number
      readonly href: string
      readonly display: 'url'
    }
  | {
      readonly form: 'text' | 'leaf'
      readonly from: number
      readonly to: number
      readonly href: string
      readonly display: LinkDisplay
      readonly node: PMNode
      readonly link: Link
    }

const LINK = 'link'

/** The model of a directive node, read through the Markdown package's own parser. */
function modelOf(node: PMNode): Link {
  const form = node.type.name === 'leafDirective' ? 'leafDirective' : 'textDirective'
  return linkDirective.parse({
    type: form,
    name: LINK,
    attributes: directiveAttributes(node),
    children: [{ type: 'text', value: node.textContent }],
  })
}

function directiveTarget(node: PMNode, from: number, fallback: LinkDisplay): LinkTarget {
  const link = modelOf(node)
  return {
    form: link.form === 'leaf' ? 'leaf' : 'text',
    from,
    to: from + node.nodeSize,
    href: link.url,
    display: effectiveDisplay(link, fallback),
    node,
    link,
  }
}

const isLinkDirective = (node: PMNode): boolean =>
  (node.type.name === 'leafDirective' || node.type.name === 'textDirective') &&
  directiveName(node) === LINK

/**
 * The link the selection is in or on, in whichever form it is written, or null.
 * A selected card is a link; so is a caret anywhere in an inline directive's
 * text or in a card's label.
 */
export function linkTargetAt(state: EditorState): LinkTarget | null {
  const { selection } = state
  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === 'leafDirective' &&
    isLinkDirective(selection.node)
  ) {
    return directiveTarget(selection.node, selection.from, linkDefaultDisplayOf(state))
  }
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (isLinkDirective(node)) {
      return directiveTarget(node, $from.before(depth), linkDefaultDisplayOf(state))
    }
  }
  const run = linkAt(state)
  return run === null
    ? null
    : { form: 'mark', from: run.from, to: run.to, href: run.href, display: 'url' }
}

/** What the target is now, as the model a directive is written from. */
function modelFor(target: LinkTarget, state: EditorState, display: LinkDisplay): Link {
  if (target.form !== 'mark') {
    const { link } = target
    return {
      ...link,
      choice: { ...link.choice, display },
      unrecognisedDisplay: null,
      form: isBlockDisplay(display) ? 'leaf' : 'text',
    }
  }
  const words = state.doc.textBetween(target.from, target.to)
  return {
    url: target.href,
    text: words === target.href || words === '' ? null : words,
    choice: { ...UNCHOSEN, display },
    unrecognisedDisplay: null,
    extra: {},
    form: isBlockDisplay(display) ? 'leaf' : 'text',
  }
}

/** The inline node a link is drawn as: its text, marked as a link or wrapped in a directive. */
function inlineNode(state: EditorState, model: Link, display: LinkDisplay): PMNode {
  const { schema } = state
  const words = model.text ?? model.url
  if (display === 'url') {
    return schema.text(words, [markType(schema, LINK).create({ href: model.url })])
  }
  return nodeType(schema, 'textDirective').create(
    { name: LINK, attributes: linkDirective.serialize(model).attributes },
    schema.text(words),
  )
}

function cardNode(state: EditorState, model: Link): PMNode {
  const { schema } = state
  return nodeType(schema, 'leafDirective').create(
    { name: LINK, attributes: linkDirective.serialize(model).attributes },
    model.text === null ? [] : schema.text(model.text),
  )
}

/** The words of a paragraph either side of a card, without the space that separated them from it. */
function trimmed(content: Fragment, edge: 'start' | 'end'): Fragment {
  const nodes: PMNode[] = []
  content.forEach((child) => nodes.push(child))
  const index = edge === 'start' ? 0 : nodes.length - 1
  const child = nodes[index]
  const text = child?.text
  if (child === undefined || text === undefined) return content
  const kept = edge === 'start' ? text.trimStart() : text.trimEnd()
  if (kept === text) return content
  if (kept === '') nodes.splice(index, 1)
  else nodes[index] = child.type.schema.text(kept, child.marks)
  return Fragment.fromArray(nodes)
}

/**
 * Puts a card where an inline link is, splitting the paragraph around it, and
 * answers where the card is, or null where a card cannot go.
 */
function placeCard(tr: Transaction, target: LinkTarget, card: PMNode): number | null {
  const $from = tr.doc.resolve(target.from)
  const parent = $from.parent
  if (parent.type.name !== 'paragraph') return null
  const start = $from.start()
  const paragraph = (content: Fragment) =>
    content.size === 0 ? [] : [parent.type.create(parent.attrs, content)]
  const before = paragraph(trimmed(parent.content.cut(0, target.from - start), 'end'))
  const after = paragraph(trimmed(parent.content.cut(target.to - start), 'start'))
  const at = $from.before()
  tr.replaceWith($from.after() - parent.nodeSize, $from.after(), [...before, card, ...after])
  return before.reduce((position, node) => position + node.nodeSize, at)
}

/**
 * A caret inside the link that was just drawn, as far along its words as the old
 * one was, so the toolbar still has the link to point at and typing carries on
 * where it was. A caret at the very edge of a link is outside it (`linkAt`), so
 * an ordinary link keeps the caret one character in.
 */
function caretInside(tr: Transaction, from: number, node: PMNode, offset: number): Transaction {
  const words = node.textContent.length
  const inside = node.isText ? Math.min(Math.max(offset, 1), Math.max(words - 1, 0)) : offset
  const position = node.isText ? from + inside : from + 1 + Math.min(offset, words)
  return tr.setSelection(TextSelection.create(tr.doc, position))
}

/**
 * Whether the selection is somewhere a block display (a card, a compact line)
 * can go: in a paragraph, which can be split around it. A heading, a table
 * cell or a placeholder cannot, and there an inline link is as far as it goes.
 */
export function blockDisplayFits(state: EditorState): boolean {
  return state.selection.$from.parent.type.name === 'paragraph'
}

/**
 * Shows the link under the selection as `display`: a plain link, an inline chip,
 * a card or an embed. Not what the link already is. A card is a block, so it
 * cannot go in a heading or a table cell: there the command is unavailable rather
 * than half done. An embed is a block too, and only for an address whose preview
 * has a frame from the allowlist (`link-embeds.ts`): an option that cannot work
 * is not offered as one that can (ADR-042).
 */
export function showLinkAs(display: LinkDisplay): Command {
  return (state, dispatch) => {
    const target = linkTargetAt(state)
    if (target === null || target.display === display) return false
    if (display === 'embed' && embedHintFor(state, target.href) === undefined) return false
    const model = modelFor(target, state, display)
    const offset = Math.max(
      state.selection.head - target.from - (target.form === 'mark' ? 0 : 1),
      0,
    )

    const tr = state.tr
    if (isBlockDisplay(display)) {
      if (target.form === 'leaf') {
        // Already a block of its own: only what it is shown as changes (card, compact, embed).
        tr.setNodeMarkup(target.from, undefined, {
          ...target.node.attrs,
          // Changed by an author, so it is written as a link and a comment from here on.
          sourceForm: null,
          attributes: linkDirective.serialize(model).attributes,
        })
        dispatch?.(tr.scrollIntoView())
        return true
      }
      const at = placeCard(tr, target, cardNode(state, model))
      if (at === null) return false
      tr.setSelection(NodeSelection.create(tr.doc, at))
    } else {
      const inline = inlineNode(state, model, display)
      if (target.form === 'leaf') {
        tr.replaceWith(
          target.from,
          target.to,
          nodeType(state.schema, 'paragraph').create(null, inline),
        )
        caretInside(tr, target.from + 1, inline, 0)
      } else {
        tr.replaceWith(target.from, target.to, inline)
        caretInside(tr, target.from, inline, offset)
      }
    }
    dispatch?.(tr.scrollIntoView())
    return true
  }
}

/**
 * Changes what an author has chosen for a link shown as a directive: the card's
 * layout, its image, and the words that replace the fetched title and
 * description. A plain link has no choices to keep, so it is unavailable there.
 */
export function setLinkChoice(patch: Partial<LinkChoice>): Command {
  return (state, dispatch) => {
    const target = linkTargetAt(state)
    if (target === null || target.form === 'mark') return false
    const model: Link = { ...target.link, choice: { ...target.link.choice, ...patch } }
    dispatch?.(
      state.tr.setNodeMarkup(target.from, undefined, {
        ...target.node.attrs,
        // Changed by an author, so it is written as a link and a comment from here on.
        sourceForm: null,
        attributes: linkDirective.serialize(model).attributes,
      }),
    )
    return true
  }
}

/**
 * Runs each command that applies, one after another, each on the document the
 * last one left, and dispatches the lot as **one** transaction, so one undo takes
 * them all back. Answers whether any of them did something.
 *
 * Two commands dispatched one after the other are two history steps whenever the
 * second does not touch the first's range, as a card replacing a link does not.
 */
export function inOneStep(...commands: readonly Command[]): Command {
  return (state, dispatch) => {
    const merged = state.tr
    let current = state
    let did = false
    for (const command of commands) {
      let produced: Transaction | null = null
      if (command(current, (tr) => (produced = tr))) {
        did = true
        if (produced !== null) {
          const tr: Transaction = produced
          for (const step of tr.steps) merged.step(step)
          current = current.apply(tr)
        }
      }
    }
    if (!did) return false
    if (dispatch !== undefined) {
      merged.setSelection(Selection.fromJSON(merged.doc, current.selection.toJSON()))
      dispatch(merged.scrollIntoView())
    }
    return true
  }
}
