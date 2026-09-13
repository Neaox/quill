import { Link, getRouteApi, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'

import { Button, Callout, Input, Spinner, tv } from '@quill/ui'

import { readInvalidQuery, useLoadedWorkspace, useSearchResults } from '../../lib/api/index.ts'
import { workspaceReference } from '../../lib/routing/document-reference.ts'
import { InvalidQueryNotice } from './invalid-query-notice.tsx'
import { SearchHitSummary, searchHitLink } from './search-hit.tsx'
import {
  ELSEWHERE_SECTION_LABEL,
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
    form: 'flex max-w-xl items-end gap-2',
    field: 'grow',
    sections: 'flex flex-col gap-8',
    section: 'flex flex-col gap-2',
    sectionHeading: 'text-xs font-medium tracking-wide text-muted uppercase',
    list: 'flex flex-col gap-1',
    hit: [
      'flex rounded-md border border-transparent px-3 py-2.5 transition-colors ease-standard',
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
        <Link
          key={hit.documentId}
          {...searchHitLink(section.workspaceSlug, hit)}
          className={styles.hit()}
        >
          <SearchHitSummary hit={hit} />
        </Link>
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

  const results = useSearchResults({ query, workspaceId: workspace.id })
  const sections = searchSections(results.data?.pages ?? [], workspace)
  const here = sections.find((section) => section.id === 'current')
  const elsewhere = sections.filter((section) => section.id !== 'current')
  const invalid = readInvalidQuery(results.error)
  const styles = searchPageStyles()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const asked = new FormData(event.currentTarget).get('q')
    void navigate({
      to: '/w/$workspaceSlug/search',
      params: { workspaceSlug: workspaceReference(workspace) },
      search: { q: typeof asked === 'string' ? asked.trim() : '' },
    })
  }

  return (
    <div className={styles.root()}>
      <h1 className={styles.heading()}>Search</h1>

      <form onSubmit={onSubmit} className={styles.form()}>
        {/* Keyed by the query so that arriving from the palette, or from the
            back button, shows what was actually searched for rather than
            whatever was last typed into a field that never remounted. */}
        <Input
          key={query}
          label="Search this organisation"
          name="q"
          type="search"
          defaultValue={query}
          placeholder='Words, "a phrase", -exclusions, tag:incident'
          className={styles.field()}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {query === '' ? (
        <p className={styles.quiet()}>
          Type something to search every workspace you can read. Matches in {workspace.name} come
          first.
        </p>
      ) : invalid !== undefined ? (
        <InvalidQueryNotice query={query} invalid={invalid} />
      ) : results.isError ? (
        <Callout tone="danger" title="Couldn't run that search">
          Search is not answering right now. Try again in a moment.
        </Callout>
      ) : results.isPending ? (
        <Spinner className="size-5" />
      ) : sectionsHitCount(sections) === 0 ? (
        <Callout tone="info" title={`Nothing matched “${query}”`}>
          Try fewer words, or check a filter’s spelling. A quoted phrase is matched exactly; every
          other word is widened when a search finds too little.
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
