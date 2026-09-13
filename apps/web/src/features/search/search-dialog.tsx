import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { CommandPalette, buttonClassName, tv, type CommandPaletteGroup } from '@quill/ui'

import {
  queryTooLong,
  readInvalidQuery,
  useSearch,
  useWorkspace,
  type SearchHit,
} from '../../lib/api/index.ts'
import {
  searchLink,
  workspaceReference,
  type DocumentLinkTarget,
} from '../../lib/routing/document-reference.ts'
import { InvalidQueryNotice } from './invalid-query-notice.tsx'
import { SearchHitDetail, searchHitLink } from './search-hit.tsx'
import {
  QUERY_TOO_LONG,
  SEARCH_PROMPT,
  SEARCH_UNAVAILABLE,
  describeResults,
  searchSections,
  type SearchSection,
} from './sections.ts'
import { useDebouncedValue } from './use-debounced-value.ts'

export const searchDialogStyles = tv({
  slots: {
    hint: 'text-2xs text-muted',
    key: 'rounded-xs border border-border-strong bg-surface px-1 py-0.5 font-mono',
    prompt: 'text-sm text-muted',
  },
})

/**
 * How long a pause in typing means "search for this".
 *
 * Long enough that a whole word is one request rather than six, short enough
 * that it still reads as typeahead. The server's own budget for a query is
 * 300 ms (quill-plan.md §31), so the wait a person feels is this plus that.
 */
const DEBOUNCE_MS = 180

/** The option id a hit is offered under. The section is part of it: the same
 * document can be reached under two workspace segments, and `documentId` alone
 * would collide. */
function optionId(section: SearchSection, hit: SearchHit): string {
  return `${section.id}:${hit.documentId}`
}

export interface SearchDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The workspace segment of the address somebody is on, when they are in one. */
  readonly workspaceSlug?: string | undefined
}

/**
 * The search palette.
 *
 * Loaded on demand by `search-provider.tsx`, which is what keeps it and
 * everything it pulls in out of the reading route's bundle.
 *
 * Two decisions worth naming:
 *
 * - **The list is derived, never stored.** What is typed is the only state
 *   here; the debounced copy drives the query, and the groups are computed
 *   from the answer on every render. There is no effect copying results into
 *   state, and so no render where the two disagree (ADR-013).
 * - **Enter navigates; it does not follow a link.** Options are the palette's
 *   own buttons, because a link inside a `role="option"` is two interactive
 *   things where assistive technology expects one. The results page, where
 *   opening a result in a new tab actually matters, renders real links.
 */
export function SearchDialog({ open, onOpenChange, workspaceSlug }: SearchDialogProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, DEBOUNCE_MS)

  // Already in the cache whenever there is a workspace in the address: the
  // shell's loader awaited it before anything inside rendered (ADR-035).
  const workspace = useWorkspace(workspaceSlug).data
  // No `limit`: `useSearch` already asks for the palette's page size.
  const results = useSearch({ query: debounced, workspaceId: workspace?.id ?? null })

  const sections = useMemo(
    () => searchSections(results.data === undefined ? [] : [results.data], workspace ?? null),
    [results.data, workspace],
  )

  const { groups, targets } = useMemo(() => {
    const destinations = new Map<string, DocumentLinkTarget>()
    const rendered: CommandPaletteGroup[] = sections.map((section) => ({
      id: section.id,
      label: section.label,
      options: section.hits.map((hit) => {
        const id = optionId(section, hit)
        destinations.set(id, searchHitLink(section.workspaceSlug, hit))
        // The title alone is the option's name; everything else describes it,
        // so the arrow keys announce "Regional failover" rather than the whole
        // snippet (`search-hit.tsx`).
        return { id, label: hit.title, detail: <SearchHitDetail hit={hit} /> }
      }),
    }))
    return { groups: rendered, targets: destinations }
  }, [sections])

  const typed = query.trim()
  /**
   * The query the answer on screen is actually about.
   *
   * Every notice is written from this rather than from what is in the box:
   * `invalid` carries an offset into the query the *server* refused, so slicing
   * the live text at it would mark the wrong character of a different string,
   * and "nothing matched" said about a query that has not been sent yet is
   * simply untrue. The box's own value stays `query`, because that is what is
   * being typed.
   */
  const answering = debounced.trim()
  /** A keystroke is waiting out the debounce, so what is on screen is not the answer to it. */
  const settling = typed !== answering
  const invalid = readInvalidQuery(results.error)
  const styles = searchDialogStyles()

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      title="Search documentation"
      inputLabel="Search documentation"
      placeholder="Search documentation"
      description="Results appear as you type. Use the up and down arrows to move between them and Enter to open one."
      value={query}
      onValueChange={setQuery}
      groups={groups}
      // Busy for the whole wait, not just the request: between a keystroke and
      // the debounce firing there is nothing in flight, and a field that drops
      // `aria-busy` there presents the previous query's hits as the answer to
      // this one (`docs/design/feedback.md`).
      busy={results.isFetching || settling}
      onSelect={(id) => {
        const target = targets.get(id)
        /* v8 ignore next -- every option's id was put in the map beside it. */
        if (target === undefined) return
        onOpenChange(false)
        void navigate(target)
      }}
      notice={notice()}
      footer={footer()}
      {...(status() === undefined ? {} : { status: status() })}
    />
  )

  /** Whether the answer on screen is the one the box is asking for. */
  function settled(): boolean {
    return !settling && !results.isPending && !results.isFetching
  }

  function notice() {
    // The live query, not the settled one: clearing the box goes back to the
    // prompt at once rather than 180 ms later, and nothing is pending.
    if (typed === '') {
      return <p className={styles.prompt()}>{SEARCH_PROMPT}</p>
    }
    if (queryTooLong(typed)) {
      return <p className={styles.prompt()}>{QUERY_TOO_LONG}</p>
    }
    // Everything below describes an answer, so it waits for one. While a
    // keystroke is settling, the field is busy and the last answer stands.
    if (!settled()) return undefined
    if (invalid !== undefined) return <InvalidQueryNotice query={answering} invalid={invalid} />
    if (results.isError) {
      return (
        <p role="alert" className={styles.prompt()}>
          {SEARCH_UNAVAILABLE}
        </p>
      )
    }
    if (groups.length === 0) {
      return <p className={styles.prompt()}>Nothing matched “{answering}”.</p>
    }
    return undefined
  }

  /**
   * What a screen reader is told once an answer has settled, and nothing at all
   * while one is on the way — which is what stops it chattering per keystroke.
   */
  function status(): string | undefined {
    if (typed === '' || !settled()) return undefined
    if (invalid !== undefined || results.isError) return undefined
    return describeResults(sections)
  }

  function footer() {
    return (
      <>
        <p className={styles.hint()}>
          <kbd className={styles.key()}>↑</kbd> <kbd className={styles.key()}>↓</kbd> to move,{' '}
          <kbd className={styles.key()}>↵</kbd> to open, <kbd className={styles.key()}>esc</kbd> to
          close
        </p>
        {/* Only inside a workspace: the results page is a place in one, and a
            control that cannot go anywhere is not rendered at all
            (`docs/design/feedback.md`). */}
        {workspace === undefined || typed === '' || queryTooLong(typed) ? undefined : (
          <Link
            {...searchLink(workspaceReference(workspace), typed)}
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            onClick={() => {
              onOpenChange(false)
            }}
          >
            See all results
          </Link>
        )}
      </>
    )
  }
}
