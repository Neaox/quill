import { MAX_QUERY_LENGTH, type SearchHit, type SearchResults } from '../../lib/api/index.ts'
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

/* --- The words both surfaces use ------------------------------------------
 *
 * Search says the same things in a palette and on a page, and a sentence
 * written twice drifts. They live beside the headings because this module is
 * already the feature's shared vocabulary.
 */

/** What an empty search box invites. */
export const SEARCH_PROMPT =
  'Type to search every workspace you can read. Matches where you are come first.'

/** What a failed request says. Never the status code: there is nothing to do with one. */
export const SEARCH_UNAVAILABLE = 'Search is not answering right now. Try again in a moment.'

/**
 * What an over-long query is told. The cap itself is `MAX_QUERY_LENGTH` in
 * `lib/api/search.ts`, beside the request it is a fact about; this is the
 * sentence, which belongs with the rest of the feature's words. Saying it here
 * rather than sending the query keeps the refusal in the same vocabulary as
 * the three the server answers with.
 */
export const QUERY_TOO_LONG = `That search is too long: ${MAX_QUERY_LENGTH} characters at most.`

/**
 * What has just been answered, as one sentence for a live region.
 *
 * Counting the workspaces as well as the hits is the point: search is the one
 * surface that crosses them (quill-plan.md §15), and "8 results" alone would
 * hide that five of them are somewhere else entirely.
 */
export function describeResults(sections: readonly SearchSection[]): string {
  const hits = sectionsHitCount(sections)
  if (hits === 0) return 'No results.'

  const here = sections.find((section) => section.id === 'current')?.hits.length ?? 0
  const elsewhere = sections.filter((section) => section.id !== 'current')
  const parts = [`${hits} ${hits === 1 ? 'result' : 'results'}`]
  if (here > 0) parts.push(`${here} in this workspace`)
  if (elsewhere.length > 0) {
    const names = elsewhere.length === 1 ? 'workspace' : 'workspaces'
    parts.push(`${sectionsHitCount(elsewhere)} in ${elsewhere.length} other ${names}`)
  }
  return `${parts.join(', ')}.`
}
