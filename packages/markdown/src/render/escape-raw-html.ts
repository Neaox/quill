import type { ElementContent, Root as HastRoot, RootContent } from 'hast'

import { isHtmlComment } from './html-comment.ts'

interface RawNode {
  readonly type: 'raw'
  readonly value: string
}

/**
 * `remark-rehype` runs with `allowDangerousHtml: true` (`html.ts`) so that raw
 * HTML written by an author — a `<div>` wrapper, an inline `<br>`, a stray
 * `<script>` — survives into the hast tree rather than being dropped outright;
 * without that flag `mdast-util-to-hast` discards `html` nodes entirely (see its
 * `handlers/html.js`). Surviving as *what*, though, is a choice this package makes
 * deliberately rather than one it leaves to a library default:
 *
 * `rehype-raw` is not installed, so nothing here parses that raw string into real
 * elements a sanitiser could inspect. Left alone, it stays a hast `raw` node — the
 * bare-string node `mdast-util-to-hast`'s dangerous mode produces, which is not
 * part of standard hast and which `hast-util-sanitize` does not recognise at all
 * (its `transform` only handles `comment`, `doctype`, `element`, `root`, and
 * `text`; everything else, `raw` included, is silently dropped). Stringifying a
 * surviving `raw` node with `allowDangerousHtml: true` would instead emit that
 * string byte-for-byte — exactly the "raw script/event-handler/`javascript:`
 * reaches the reader" finding this module closes.
 *
 * So: every `raw` node is turned into a `text` node before the sanitiser ever
 * runs. A `text` node is always kept (hast-util-sanitize never applies its schema
 * to text) and is always HTML-escaped at stringify time, so a source document
 * containing `<script>alert(1)</script>` renders the literal, inert characters
 * `&lt;script&gt;alert(1)&lt;/script&gt;` — visible to the reader, never executed,
 * never silently dropped.
 *
 * The one exception is raw HTML that is only comments (`html-comment.ts`). A
 * comment is an author's note, not content, so it is hidden, as GitHub hides
 * it (ADR-011, amendment "HTML comments"). Hiding it drops a note no reader
 * was meant to see, not something the author wrote for them.
 */
function isRaw(node: object): node is RawNode {
  return (node as { readonly type?: unknown }).type === 'raw'
}

function escapeElementContent(node: ElementContent): ElementContent[] {
  if (isRaw(node)) return isHtmlComment(node.value) ? [] : [{ type: 'text', value: node.value }]
  if (node.type !== 'element') return [node]
  return [{ ...node, children: node.children.flatMap(escapeElementContent) }]
}

function escapeRootContent(node: RootContent): RootContent[] {
  if (isRaw(node)) return isHtmlComment(node.value) ? [] : [{ type: 'text', value: node.value }]
  if (node.type !== 'element') return [node]
  return [{ ...node, children: node.children.flatMap(escapeElementContent) }]
}

/** Applies the escaping above to a whole document tree, top to bottom. */
export function escapeRawHtml(root: HastRoot): HastRoot {
  return { ...root, children: root.children.flatMap(escapeRootContent) }
}
