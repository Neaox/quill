import type { ChildPageNode, DocumentRow } from '@quill/application'
import type { ChildPage } from '@quill/markdown'

/**
 * The use case's tree in the template's terms (ADR-054): each page with the
 * address the surface reads it at — its reading address in the app, by its
 * short key (ADR-035),
 * a site path on the public site — and a draft marked as one.
 */
export function toChildPages(
  nodes: readonly ChildPageNode[],
  hrefOf: (document: DocumentRow) => string,
): readonly ChildPage[] {
  return nodes.map((node) => ({
    id: node.document.id,
    title: node.document.title,
    href: hrefOf(node.document),
    draft: node.document.headRevision === null,
    excerpt: node.summary ?? undefined,
    icon: node.icon ?? undefined,
    children: toChildPages(node.children, hrefOf),
  }))
}

/** How many pages a tree lists, at every depth. */
export function countChildPages(pages: readonly ChildPage[]): number {
  return pages.reduce((total, page) => total + 1 + countChildPages(page.children), 0)
}
