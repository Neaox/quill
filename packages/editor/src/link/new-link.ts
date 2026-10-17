import { UNCHOSEN, linkDirective } from '@quill/markdown'
import type { Link } from '@quill/markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

import { nodeType } from '../schema/node-type.ts'

/**
 * A link that has just been made, as the node the document holds (ADR-042).
 *
 * The attributes come from the Markdown package's own writer, so a link made
 * here is written exactly as the renderer expects to read it. A bare address
 * spells itself: the file reads `:link[https://…]{display=inline}`, which is its
 * address wherever the directive is not understood.
 */

export type NewLinkDisplay = 'inline' | 'compact' | 'card'

function modelOf(url: string, display: NewLinkDisplay): Link {
  return {
    url,
    text: null,
    choice: { ...UNCHOSEN, display },
    unrecognisedDisplay: null,
    extra: {},
    form: display === 'inline' ? 'text' : 'leaf',
  }
}

/** The inline node for an address: its words are the address until the page's own title is shown. */
export function inlineLinkNode(schema: Schema, url: string): PMNode {
  return nodeType(schema, 'textDirective').create(
    { name: 'link', attributes: linkDirective.serialize(modelOf(url, 'inline')).attributes },
    schema.text(url),
  )
}

/** The block node for an address: a card or a compact line, which is its settings and no words of its own. */
export function blockLinkNode(
  schema: Schema,
  url: string,
  display: Exclude<NewLinkDisplay, 'inline'>,
): PMNode {
  return nodeType(schema, 'leafDirective').create({
    name: 'link',
    attributes: linkDirective.serialize(modelOf(url, display)).attributes,
  })
}

/** A card for an address. */
export const cardLinkNode = (schema: Schema, url: string): PMNode =>
  blockLinkNode(schema, url, 'card')

/** An address worth previewing: an absolute web address, which is all a preview can be made of. */
export function previewableAddress(text: string): string | null {
  const trimmed = text.trim()
  if (!/^https?:\/\/\S+$/u.test(trimmed)) return null
  return URL.canParse(trimmed) ? trimmed : null
}
