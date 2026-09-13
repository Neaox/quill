import type { SearchHit, SearchResults } from '../../lib/api/index.ts'
import {
  workspaceReference,
  type ReferencableWorkspace,
} from '../../lib/routing/document-reference.ts'

/**
 * How search results are grouped on screen, for both surfaces that show them.
 *
 * Search is the one place the product crosses workspaces (quill-plan.md §15),
 * and the answer says so: what matched where the person is, then everything
 * else grouped by workspace. That shape is worked out here, once, so the
 * palette and the results page cannot group the same answer differently — and
 * so that paging, which the palette does not do and the page does, merges
 * groups rather than repeating their headings down the list.
 */

export interface SearchSection {
  /** `current`, or the workspace's id. Stable across pages, so it is a React key. */
  readonly id: string
  /** The heading above the group. */
  readonly label: string
  /** The workspace segment every hit in this group is addressed under (ADR-035). */
  readonly workspaceSlug: string
  readonly hits: readonly SearchHit[]
}

/**
 * The workspace a search is being run from, as the grouping needs it: enough
 * to address it (ADR-035), which is what `workspaceReference` asks for.
 */
export type CurrentWorkspace = ReferencableWorkspace

/** The heading above matches in the workspace the person is already in. */
export const CURRENT_SECTION_LABEL = 'In this workspace'

/** The heading the other workspaces' groups sit under. */
export const ELSEWHERE_SECTION_LABEL = 'Elsewhere'

/**
 * Every page's groups, flattened into the sections a surface renders.
 *
 * `current` is only ever a section when a workspace was in scope — without
 * one the server leaves it empty and offers everything as a grouped
 * suggestion — and a group with no hits is omitted rather than shown as an
 * empty heading.
 */
export function searchSections(
  pages: readonly SearchResults[],
  current: CurrentWorkspace | null,
): readonly SearchSection[] {
  const currentHits = pages.flatMap((page) => page.current)
  const sections: SearchSection[] = []

  if (current !== null && currentHits.length > 0) {
    sections.push({
      id: 'current',
      label: CURRENT_SECTION_LABEL,
      workspaceSlug: workspaceReference(current),
      hits: currentHits,
    })
  }

  // A later page may carry more hits for a workspace an earlier one already
  // opened a group for, so groups are merged by workspace rather than
  // appended: the heading appears once, in the order it was first offered.
  const elsewhere = new Map<string, SearchSection & { hits: SearchHit[] }>()
  for (const page of pages) {
    for (const group of page.elsewhere) {
      const existing = elsewhere.get(group.workspace.id)
      if (existing === undefined) {
        elsewhere.set(group.workspace.id, {
          id: group.workspace.id,
          label: group.workspace.name,
          workspaceSlug: workspaceReference(group.workspace),
          hits: [...group.hits],
        })
      } else {
        existing.hits.push(...group.hits)
      }
    }
  }

  for (const section of elsewhere.values()) {
    if (section.hits.length > 0) sections.push(section)
  }
  return sections
}

/** How many documents a set of sections is offering, for "no results" and for counts. */
export function sectionsHitCount(sections: readonly SearchSection[]): number {
  return sections.reduce((total, section) => total + section.hits.length, 0)
}
