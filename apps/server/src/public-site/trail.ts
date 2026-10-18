import type { DocumentId } from '@quill/domain'

/**
 * Where a page sits on a site: the titles of the pages above it.
 *
 * A search result is a title with a snippet, and two pages called "Overview"
 * are told apart by what they are under. The trail follows the same rule the
 * site's navigation does (`publicNavigationOf`): a parent that is not on the
 * site is not named, because naming it would tell a stranger the title of a
 * page they may not read.
 */

interface TrailPage {
  readonly id: DocumentId
  readonly parentId: DocumentId | null
  readonly title: string
}

/** Built once over a site's pages, so each result costs a walk up the tree and not a scan of it. */
export function createTrailReader(
  pages: Iterable<TrailPage>,
): (documentId: DocumentId) => readonly string[] {
  const byId = new Map<DocumentId, TrailPage>()
  for (const page of pages) byId.set(page.id, page)

  return (documentId) => {
    const trail: string[] = []
    const seen = new Set<DocumentId>([documentId])
    let parentId = byId.get(documentId)?.parentId ?? null
    while (parentId !== null && !seen.has(parentId)) {
      const parent = byId.get(parentId)
      if (parent === undefined) break
      trail.unshift(parent.title)
      seen.add(parentId)
      parentId = parent.parentId
    }
    return trail
  }
}
