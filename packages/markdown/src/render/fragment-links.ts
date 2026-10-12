import type { Element, Root as HastRoot } from 'hast'
import { visit } from 'unist-util-visit'

import { HEADING_ID_PREFIX } from './slug.ts'

/**
 * Sends an in-page link to the heading it names.
 *
 * An author writes `[the loop](#the-loop)`, the way every Markdown host
 * spells a link to a heading, but a rendered heading's id carries the
 * clobbering prefix (`slug.ts`), so the link as written lands nowhere. GitHub
 * mends this in the reader with script; this renderer has none to spare and
 * mends it in the markup instead, over the finished tree, for every
 * fragment-only link that does not already name a rendered id. Links that
 * leave the page keep their fragment as written: it belongs to the page they
 * go to.
 */
export function prefixFragmentLinks(tree: HastRoot): HastRoot {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'a') return
    const href = node.properties['href']
    if (typeof href !== 'string' || !href.startsWith('#') || href.length === 1) return
    if (href.startsWith(`#${HEADING_ID_PREFIX}`)) return
    node.properties['href'] = `#${HEADING_ID_PREFIX}${href.slice(1)}`
  })
  return tree
}
