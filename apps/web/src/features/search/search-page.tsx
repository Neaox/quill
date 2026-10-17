import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'

import type { FieldFilterKey } from '@quill/search/query'
import { Button, Callout, Spinner, tv } from '@quill/ui'

import {
  queryTooLong,
  readInvalidQuery,
  RESULTS_FACETS,
  useLoadedWorkspace,
  useSearchResults,
} from '../../lib/api/index.ts'
import { searchLink, workspaceReference } from '../../lib/routing/document-reference.ts'
import { AddFilterRow } from './add-filter-row.tsx'
import { FilterChipList } from './filter-chip-list.tsx'
import { InvalidQueryNotice } from './invalid-query-notice.tsx'
import { SearchHitLink } from './search-hit.tsx'
import { SearchQueryField, type SearchQueryFieldHandle } from './search-query-field.tsx'
import { RefineFacets, useRetainedFacets } from './refine-facets.tsx'
import { filterChips, withClause, withoutClause, type FilterChip } from './search-filters.ts'
import {
  ELSEWHERE_SECTION_LABEL,
  QUERY_TOO_LONG,
  SEARCH_PROMPT,
  SEARCH_UNAVAILABLE,
  describeResults,
  searchSections,
  sectionsHitCount,
  type SearchSection,
} from './sections.ts'

export const searchPageStyles = tv({
  slots: {
    // Capped at the reading grid's `wide` line (ADR-027) rather than filling
    // whatever the shell leaves: a snippet is a line of prose, and a snippet
    // set a hundred and forty characters wide is not readable at three in the
    // morning, which is when this page is used.
    root: 'flex w-full max-w-(--layout-wide) flex-col gap-6 px-8 py-8',
    heading: 'text-2xl font-semibold tracking-tight text-foreground',
    search: 'flex max-w-xl flex-col gap-3',
    form: 'flex items-end gap-2',
    field: 'min-w-0 grow',
    sections: 'flex flex-col gap-8',
    section: 'flex flex-col gap-2',
    sectionHeading: 'text-xs font-medium tracking-wide text-muted uppercase',
    list: 'flex flex-col gap-1',
    hit: [
      'flex min-w-0 rounded-md border border-transparent px-3 py-2.5 transition-colors ease-standard',
      'hover:border-border hover:bg-surface',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    more: 'flex justify-center pt-2',
    quiet: 'text-sm text-muted',
  },
})

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/search')

/**
 * One group's results, as real links: a results page is where opening a hit in
 * a new tab, or copying its address, actually matters, so these are anchors
 * built by the helper (ADR-035) rather than the palette's buttons.
 */
function HitList({ section }: { readonly section: SearchSection }) {
  const styles = searchPageStyles()

  return (
    <div className={styles.list()}>
      {section.hits.map((hit) => (
        <SearchHitLink
          key={`${section.id}:${hit.documentId}`}
          hit={hit}
          workspaceSlug={section.workspaceSlug}
          className={styles.hit()}
        />
      ))}
    </div>
  )
}

/**
 * The full search results for one query, inside the workspace shell.
 *
 * The palette answers "which document did I mean?" in eight rows; this answers
 * "show me everything", and is the place a search is linked to and shared
 * from — which is why the query is a search param rather than component state
 * (ADR-013).
 *
 * The grouping is the palette's, from the same module: this workspace first,
 * then every other workspace the reader may see, each under its own name
 * (quill-plan.md §15). Paging merges into those groups rather than repeating
 * their headings, so "Show more" lengthens the page instead of starting it
 * again.
 */
export function SearchPage() {
  const { workspaceSlug } = routeApi.useParams()
  const { q } = routeApi.useSearch()
  const navigate = useNavigate()
  // Awaited by the shell's loader before this page rendered (ADR-035).
  const workspace = useLoadedWorkspace(workspaceSlug).data
  const query = q ?? ''

  // What is in the box is a draft; the address holds the query that was asked.
  // The draft follows the address when it changes under us (back, a removed
  // chip, "See all results" from the palette) by being reset *while rendering*
  // — an effect would paint one frame of the old text first — and the field is
  // never remounted, so focus stays where it is.
  const [draft, setDraft] = useState(query)
  const [draftFor, setDraftFor] = useState(query)
  if (draftFor !== query) {
    setDraftFor(query)
    setDraft(query)
  }
  const field = useRef<SearchQueryFieldHandle | null>(null)
  const chips = filterChips(query)

  const results = useSearchResults({ query, workspaceId: workspace.id, facets: RESULTS_FACETS })
  const sections = searchSections(results.data?.pages ?? [], workspace)
  const here = sections.find((section) => section.id === 'current')
  const elsewhere = sections.filter((section) => section.id !== 'current')
  const invalid = readInvalidQuery(results.error)
  // The first page's: counts are over the whole answer, so paging adds none.
  const facets = useRetainedFacets(results.data?.pages[0])
  const busy = results.isFetching
  // Said only once an answer has settled, so paging announces the longer list
  // rather than the act of asking for it.
  const announcement =
    query === '' || busy || results.isError || invalid !== undefined
      ? ''
      : describeResults(sections)
  const styles = searchPageStyles()

  function ask(asked: string): void {
    void navigate(searchLink(workspaceReference(workspace), asked))
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    ask(draft.trim())
  }

  function removeFilter(chip: FilterChip): void {
    ask(withoutClause(query, chip.clause))
    // The chip that had focus is about to be gone.
    field.current?.focus()
  }

  function refine(key: FieldFilterKey, value: string): void {
    ask(withClause(query, key, value))
    // The pill that had focus is about to be gone (what it chose is no longer
    // offered), and the field is where chip removal already sends focus: one
    // place to land after any change to the query, and the place to carry on.
    field.current?.focus()
  }

  // Not while the query is empty, too long, refused or failing: what was
  // counted would describe a search that is not the one on screen.
  const refinable =
    query !== '' && !queryTooLong(query) && invalid === undefined && !results.isError

  return (
    <div aria-busy={busy} className={styles.root()}>
      <h1 className={styles.heading()}>Search</h1>

      <div className={styles.search()}>
        <form onSubmit={onSubmit} className={styles.form()}>
          <SearchQueryField
            ref={field}
            label="Search this organisation"
            value={draft}
            onValueChange={setDraft}
            workspaceId={workspace.id}
            placeholder='Words, "a phrase", -exclusions, tag:incident, by:me'
            className={styles.field()}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {/* The applied query's filters, not the draft's: a chip says what the
            results below are about, and only a search changes that. */}
        <FilterChipList chips={chips} onRemove={removeFilter} />
        <AddFilterRow
          onAdd={(key) => {
            field.current?.addFilter(key)
          }}
        />
      </div>

      {refinable ? <RefineFacets facets={facets} query={query} onRefine={refine} /> : undefined}

      {/* Polite, so a page that has just lengthened under "Show more" is
          announced without interrupting whatever is being read. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {query === '' ? (
        <p className={styles.quiet()}>{SEARCH_PROMPT}</p>
      ) : queryTooLong(query) ? (
        <p className={styles.quiet()}>{QUERY_TOO_LONG}</p>
      ) : invalid !== undefined ? (
        <InvalidQueryNotice query={query} invalid={invalid} />
      ) : results.isError ? (
        <Callout tone="danger" title="Couldn't run that search">
          {SEARCH_UNAVAILABLE}
        </Callout>
      ) : results.isPending ? (
        // `Spinner` is decorative by its own contract, so the words beside it
        // are what actually say the page is working (`docs/design/feedback.md`).
        <p className={styles.quiet()}>
          <Spinner className="size-4" /> Searching…
        </p>
      ) : sectionsHitCount(sections) === 0 ? (
        <Callout tone="info" title={`Nothing matched “${query}”`}>
          {chips.length === 0
            ? 'Try fewer words, or check a filter’s spelling.'
            : 'Try removing a filter, or use fewer words.'}{' '}
          A quoted phrase is matched exactly; every other word is widened when a search finds too
          little.
        </Callout>
      ) : (
        <div className={styles.sections()}>
          {here === undefined ? undefined : (
            <section className={styles.section()}>
              <h2 className={styles.sectionHeading()}>{here.label}</h2>
              <HitList section={here} />
            </section>
          )}

          {/* "Elsewhere" is said once, as the heading over every other
              workspace's group, because it names the boundary rather than any
              one of them (`docs/architecture/api-contract-m2.md`). Each
              workspace is then a level below it, so the outline of the page
              reads the way the results are grouped. */}
          {elsewhere.length === 0 ? undefined : (
            <section className={styles.section()}>
              <h2 className={styles.sectionHeading()}>{ELSEWHERE_SECTION_LABEL}</h2>
              {elsewhere.map((section) => (
                <section key={section.id} className={styles.section()}>
                  <h3 className={styles.sectionHeading()}>{section.label}</h3>
                  <HitList section={section} />
                </section>
              ))}
            </section>
          )}

          {results.hasNextPage ? (
            <div className={styles.more()}>
              <Button
                variant="secondary"
                loading={results.isFetchingNextPage}
                onClick={() => {
                  void results.fetchNextPage()
                }}
              >
                Show more
              </Button>
            </div>
          ) : undefined}
        </div>
      )}
    </div>
  )
}
