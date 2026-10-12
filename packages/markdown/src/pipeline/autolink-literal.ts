import { toString } from 'mdast-util-to-string'
import type { Link, Root } from 'mdast'
import { visit } from 'unist-util-visit'

import { rewriteTree } from '../tree.ts'
import { rawMdast } from './raw-mdast.ts'

/**
 * GFM autolink literals, written back the way they were written (ADR-002).
 *
 * mdast keeps no record of whether a link was a bare address
 * (`https://example.com`), an angle-bracket autolink (`<https://example.com>`)
 * or a resource link, and the writer chooses angle brackets for any link
 * whose words are its address. So every save rewrote an author's bare URL.
 * Parsing marks a link that was written bare; writing puts a marked link back
 * bare, verbatim, and keeps it only if reading the result back gives the same
 * links, falling back to the ordinary form otherwise.
 */

declare module 'mdast' {
  interface LinkData {
    /** Written bare in the source, as a GFM autolink literal. */
    autolinkLiteral?: boolean | undefined
  }
}

/**
 * Marks every link whose source is exactly its own words: only a literal is
 * written that way, since every other link form opens with `<` or `[`.
 * Mutates the tree it is given, which is the parser's own fresh one.
 */
export function markAutolinkLiterals(tree: Root, source: string): Root {
  visit(tree, 'link', (node: Link) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return
    if (source.slice(start, end) !== toString(node)) return
    node.data = { ...node.data, autolinkLiteral: true }
  })
  return tree
}

/**
 * The bare text a marked link can be written as: its words, when they are its
 * address the way GFM reads one — the URL itself, `www.` under `http://`, or
 * an email address under `mailto:`. Undefined for anything else, including a
 * link whose words or address were edited apart.
 */
function bareForm(link: Link): string | undefined {
  if (link.data?.autolinkLiteral !== true || (link.title !== null && link.title !== undefined)) {
    return undefined
  }
  const [only] = link.children
  if (link.children.length !== 1 || only?.type !== 'text') return undefined
  const words = only.value
  const addresses = [words, `http://${words}`, `mailto:${words}`]
  return addresses.includes(link.url) ? words : undefined
}

/** The marked links that can be written bare, as verbatim source. */
export function withBareAutolinks(tree: Root): { readonly tree: Root; readonly bare: number } {
  let bare = 0
  const rewritten = rewriteTree(tree, (node) => {
    if (node.type !== 'link') return undefined
    const words = bareForm(node)
    if (words === undefined) return undefined
    bare += 1
    return [rawMdast(words)]
  })
  return { tree: rewritten, bare }
}

/** Every link in a tree, address and words, in order: what reading back must reproduce. */
export function linksOf(tree: Root): string {
  const links: string[] = []
  visit(tree, 'link', (node: Link) => {
    links.push(`${node.url}\u0000${toString(node)}`)
  })
  return links.join('\u0001')
}
