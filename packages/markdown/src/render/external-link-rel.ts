import type { Element, ElementContent, Root as HastRoot, RootContent } from 'hast'

import { isExternal } from './links.ts'

/**
 * ADR-011: "external links get `rel=\"noopener noreferrer\"`." Nothing upstream
 * sets it — `remark-rehype`'s default `link`/`linkReference` handlers, and the
 * `heading-anchor` this package adds itself (`handlers.ts`), only ever set `href`
 * — so it is added here, once, over the finished tree, rather than duplicated into
 * every place an `<a>` can originate. A link already carrying a `rel` (should one
 * ever be set upstream) is left alone rather than overwritten.
 */
function addRel(element: Element): Element {
  if (element.tagName !== 'a') return element
  const href = element.properties['href']
  if (typeof href !== 'string' || !isExternal(href)) return element
  if (element.properties['rel'] !== undefined) return element
  return { ...element, properties: { ...element.properties, rel: ['noopener', 'noreferrer'] } }
}

function visitElementContent(node: ElementContent): ElementContent {
  if (node.type !== 'element') return node
  const children = node.children.map(visitElementContent)
  return addRel({ ...node, children })
}

function visitRootContent(node: RootContent): RootContent {
  if (node.type !== 'element') return node
  const children = node.children.map(visitElementContent)
  return addRel({ ...node, children })
}

/** Applies the rule above to every anchor in a whole document tree. */
export function addExternalLinkRel(root: HastRoot): HastRoot {
  return { ...root, children: root.children.map(visitRootContent) }
}
