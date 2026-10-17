import type { Html, Link, Paragraph, Parent, PhrasingContent, Root } from 'mdast'
import type { LeafDirective, TextDirective } from 'mdast-util-directive'
import { toString } from 'mdast-util-to-string'
import { SKIP, visit } from 'unist-util-visit'

import { linkDirective } from './link.ts'

/**
 * A link's display, stored where every Markdown tool leaves it alone (ADR-042,
 * "A link is a link").
 *
 * The document holds an ordinary link, `[the design doc](https://…)`, which
 * works in every renderer: GitHub, a diff, an editor with no idea what Quill
 * is. A presentation the author chose is a comment beside it,
 * `[the design doc](https://…)<!-- quill:link display=card -->`, which is
 * invisible everywhere else, so what any other tool shows is the plain link.
 *
 * This module is the one place that knows the form. Reading turns a link and the
 * comment after it into the `link` directive node the rest of the product already
 * understands (the editor, the renderer, the slot fill), and writing turns that
 * node back. Nothing else is told, which is what keeps the compatibility in one
 * file instead of in every consumer.
 *
 * - A paragraph that holds nothing but the link and its comment is a **block**
 *   (a leaf directive: a card, a compact line, an embed). Anywhere else the
 *   comment follows a link inside a line of text and is **inline** (a text
 *   directive). Where a block cannot go (the first paragraph of a list item,
 *   whose schema needs a paragraph there) the link stays inline, which draws as
 *   a chip.
 * - The attributes are the directive's own: `display`, `layout`, `image=none`,
 *   `title`, `description`, and any this release does not know, which survive
 *   (AGENTS.md rule 7). The address is the link's own; it is not repeated.
 * - A document written with the older directive form (`:link[…]{…}`,
 *   `::link{…}`) still reads, and is written back in the form it was read in
 *   until the author changes that link.
 * - A comment whose attributes read as the same attributes is written back as
 *   it was, so an unchanged document is not reformatted.
 */

const COMMENT = /^<!--\s*quill:link(?:\s+([^]*?))?\s*-->$/u
const PLAIN_VALUE = /^[A-Za-z0-9_.]+$/u

declare module 'mdast' {
  interface Data {
    /** The comment a link directive was read from, to write it back as it was (`link-comment.ts`). */
    linkComment?: string | undefined
  }
}

type LinkDirective = LeafDirective | TextDirective

// ---------------------------------------------------------------------------
// The attribute list inside the comment
// ---------------------------------------------------------------------------

const ESCAPES: Readonly<Record<string, string>> = { n: '\n' }

/**
 * `key=value`, `key="quoted value"` and a bare `key` (the empty string, as in
 * a directive's `{image}`), in order. A value is quoted unless it is a plain word.
 * Inside quotes a backslash escapes: `\"`, `\\`, `\-` (every hyphen is escaped
 * when written, so a value can never contain the `--` that ends a comment early)
 * and `\n`. Null for a list that does not read, which is then left as a comment.
 */
export function readCommentAttributes(source: string): Record<string, string> | null {
  const attributes: Record<string, string> = {}
  let at = 0
  const skip = () => {
    while (at < source.length && /\s/u.test(source.charAt(at))) at += 1
  }
  skip()
  while (at < source.length) {
    const start = at
    while (at < source.length && /[A-Za-z0-9_-]/u.test(source.charAt(at))) at += 1
    const key = source.slice(start, at)
    if (key === '') return null
    let value = ''
    if (source.charAt(at) === '=') {
      at += 1
      if (source.charAt(at) === '"') {
        at += 1
        let closed = false
        while (at < source.length) {
          const char = source.charAt(at)
          at += 1
          if (char === '"') {
            closed = true
            break
          }
          if (char === '\\') {
            const next = source.charAt(at)
            at += 1
            value += ESCAPES[next] ?? next
          } else {
            value += char
          }
        }
        if (!closed) return null
      } else {
        const begin = at
        while (at < source.length && !/\s/u.test(source.charAt(at))) at += 1
        value = source.slice(begin, at)
      }
    }
    attributes[key] = value
    skip()
  }
  return attributes
}

function quote(value: string): string {
  if (PLAIN_VALUE.test(value)) return value
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('-', '\\-')
    .replaceAll('\n', '\\n')
  return `"${escaped}"`
}

/** The comment for these attributes, in the order given. */
export function writeCommentAttributes(attributes: Readonly<Record<string, string>>): string {
  const parts = Object.entries(attributes).map(([key, value]) =>
    value === '' ? key : `${key}=${quote(value)}`,
  )
  return `<!-- ${['quill:link', ...parts].join(' ')} -->`
}

/** The attributes of a Quill link comment, or null for any other node. */
function commentOf(node: PhrasingContent | undefined): Record<string, string> | null {
  if (node?.type !== 'html') return null
  const match = COMMENT.exec(node.value)
  return match === null ? null : readCommentAttributes(match[1] ?? '')
}

// ---------------------------------------------------------------------------
// Reading: a link and its comment become a link directive
// ---------------------------------------------------------------------------

const isBlank = (node: PhrasingContent): boolean => node.type === 'text' && node.value.trim() === ''

/** What the two directive forms share: the address as the `url` attribute, the words as the label. */
function directiveParts(link: Link, comment: Html, attributes: Record<string, string>) {
  const words = toString(link)
  return {
    name: 'link',
    attributes: { url: link.url, ...attributes },
    children: words === '' ? [] : [{ type: 'text' as const, value: words }],
    data: { linkComment: comment.value },
  }
}

/**
 * Whether a block may take the place of a paragraph, given where it is. The first
 * paragraph of a list item stays a paragraph, because the editor's schema needs
 * one there; a link in it is inline.
 */
function mayBeBlock(parent: Parent | undefined, index: number): boolean {
  if (parent?.type === 'listItem') return index > 0
  return (
    parent?.type === 'root' ||
    parent?.type === 'blockquote' ||
    parent?.type === 'containerDirective'
  )
}

/** The leaf directive a paragraph of nothing but a link and its comment stands for, or null. */
function blockLink(paragraph: Paragraph): LeafDirective | null {
  const [link, comment, ...rest] = paragraph.children.filter((child) => !isBlank(child))
  if (rest.length > 0 || link?.type !== 'link' || comment?.type !== 'html') return null
  const attributes = commentOf(comment)
  return attributes === null
    ? null
    : { type: 'leafDirective', ...directiveParts(link, comment, attributes) }
}

/** A line's children with each link that is followed by a Quill comment made a text directive. */
function inlineLinks(children: readonly PhrasingContent[]): PhrasingContent[] | null {
  const out: PhrasingContent[] = []
  let changed = false
  for (let at = 0; at < children.length; at += 1) {
    const child = children[at]
    if (child === undefined) continue
    if (child.type === 'link') {
      let next = at + 1
      for (
        let after = children[next];
        after !== undefined && isBlank(after);
        after = children[next]
      ) {
        next += 1
      }
      const candidate = children[next]
      const attributes = commentOf(candidate)
      if (candidate?.type === 'html' && attributes !== null) {
        out.push({ type: 'textDirective', ...directiveParts(child, candidate, attributes) })
        at = next
        changed = true
        continue
      }
    }
    out.push(child)
  }
  return changed ? out : null
}

/**
 * Turns every link followed by a Quill comment into a link directive. The nodes
 * are replaced in place, as the other readers in this pipeline do, because the
 * tree is the parser's own and not shared.
 */
export function readLinkComments(tree: Root): Root {
  // Links written as the directive keep that form until an author changes them.
  visit(tree, (node) => {
    if (isLinkDirective(node)) {
      node.data = { ...node.data, sourceForm: { ...node.data?.sourceForm, directiveForm: true } }
    }
  })
  visit(tree, 'paragraph', (paragraph, index, parent) => {
    const block = index !== undefined && mayBeBlock(parent, index) ? blockLink(paragraph) : null
    if (block !== null && parent !== undefined && index !== undefined) {
      parent.children[index] = block
      return SKIP
    }
    const inline = inlineLinks(paragraph.children)
    if (inline !== null) paragraph.children = inline
    return undefined
  })
  return tree
}

// ---------------------------------------------------------------------------
// Writing: a link directive becomes a link and its comment
// ---------------------------------------------------------------------------

/** Whether a directive node was read from the older directive form, which is kept until it changes. */
function writtenAsDirective(node: LinkDirective): boolean {
  return node.data?.sourceForm?.directiveForm === true
}

function isLinkDirective(node: unknown): node is LinkDirective {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    (node.type === 'textDirective' || node.type === 'leafDirective') &&
    'name' in node &&
    node.name === 'link'
  )
}

function commentFor(node: LinkDirective): { link: Link; comment: Html } {
  const model = linkDirective.parse(node)
  // The address is the link's own; the comment never repeats it.
  const written = linkDirective.serialize({ ...model, form: 'text' }).attributes ?? {}
  const attributes: Record<string, string> = Object.fromEntries(
    Object.entries(written).flatMap(([key, value]) =>
      key === 'url' || typeof value !== 'string' ? [] : [[key, value]],
    ),
  )
  const kept = node.data?.linkComment
  const reads = kept === undefined ? null : COMMENT.exec(kept)
  const original = reads === null ? null : readCommentAttributes(reads[1] ?? '')
  const unchanged =
    kept !== undefined &&
    original !== null &&
    JSON.stringify(Object.entries(original).toSorted()) ===
      JSON.stringify(Object.entries(attributes).toSorted())
  return {
    link: {
      type: 'link',
      url: model.url,
      title: null,
      children: [{ type: 'text', value: model.text ?? model.url }],
    },
    comment: { type: 'html', value: unchanged ? kept : writeCommentAttributes(attributes) },
  }
}

/**
 * Turns every link directive that was not written in the older form into an
 * ordinary link and the comment after it. Returns the tree it was given when
 * there is nothing to change, so the common document costs one walk.
 */
export function writeLinkComments(tree: Root): Root {
  let found = false
  visit(tree, (node) => {
    if (isLinkDirective(node) && !writtenAsDirective(node)) {
      found = true
      return false
    }
    return undefined
  })
  if (!found) return tree

  const copy = structuredClone(tree)
  visit(copy, (node, index, parent) => {
    if (
      !isLinkDirective(node) ||
      writtenAsDirective(node) ||
      parent === undefined ||
      index === undefined
    ) {
      return undefined
    }
    const { link, comment } = commentFor(node)
    if (node.type === 'leafDirective') {
      parent.children[index] = {
        type: 'paragraph',
        children: [link, { type: 'text', value: ' ' }, comment],
      }
    } else {
      parent.children.splice(index, 1, link, comment)
      return index + 2
    }
    return SKIP
  })
  return copy
}
