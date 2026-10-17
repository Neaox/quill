import rehypeStringify from 'rehype-stringify'
import { fromHtml } from 'hast-util-from-html'
import { unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'
import type { Element } from 'hast'

/**
 * What becomes of one link in a rendered body: left as it is, given another
 * address, or reduced to its words.
 */
export type LinkRewrite =
  | { readonly kind: 'keep' }
  | { readonly kind: 'href'; readonly href: string }
  | { readonly kind: 'text' }

const stringify = unified().use(rehypeStringify).freeze()

/**
 * A rendered body with its links readdressed for the surface serving it.
 *
 * The cached body is one artefact for every surface (ADR-031), and a link to
 * another document is written in it the way the store holds it (`/d/<id>`,
 * ADR-035). Only the surface knows where that document is read — the public
 * site at its path, a share link inside its token, nowhere at all for a page
 * the reader may not know exists — so each surface decides per link, after
 * the cache, the same way it fills the child pages slots (ADR-032).
 *
 * A link reduced to text keeps its words, which are the author's and already
 * on the page, and loses its element and its address, which are not.
 */
export function rewriteLinks(html: string, rewrite: (href: string) => LinkRewrite): string {
  if (!html.includes('<a ')) return html
  const tree = fromHtml(html, { fragment: true })
  let changed = false
  visit(tree, 'element', (node: Element, index, parent) => {
    const href = node.properties['href']
    if (node.tagName !== 'a' || typeof href !== 'string') return undefined
    const decision = rewrite(href)
    if (decision.kind === 'keep') return undefined
    changed = true
    if (decision.kind === 'href') {
      node.properties['href'] = decision.href
      return undefined
    }
    /* v8 ignore next -- an element inside a fragment always has a parent. */
    if (parent === undefined || index === undefined) return undefined
    parent.children.splice(index, 1, ...node.children)
    // The words now stand where the link stood: visit them from there.
    return [SKIP, index]
  })
  return changed ? stringify.stringify(tree) : html
}
