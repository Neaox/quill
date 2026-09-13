import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { CommandPalette, buttonClassName, tv, type CommandPaletteGroup } from '@quill/ui'

import {
  PALETTE_LIMIT,
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
import { SearchHitSummary, searchHitLink } from './search-hit.tsx'
import { searchSections, type SearchSection } from './sections.ts'
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
  const results = useSearch({
    query: debounced,
    workspaceId: workspace?.id ?? null,
    limit: PALETTE_LIMIT,
  })

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
        return { id, content: <SearchHitSummary hit={hit} /> }
      }),
    }))
    return { groups: rendered, targets: destinations }
  }, [sections])

  const typed = query.trim()
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
      busy={results.isFetching}
      onSelect={(id) => {
        const target = targets.get(id)
        /* v8 ignore next -- every option's id was put in the map beside it. */
        if (target === undefined) return
        onOpenChange(false)
        void navigate(target)
      }}
      notice={notice()}
      footer={footer()}
    />
  )

  function notice() {
    if (typed === '') {
      return (
        <p className={styles.prompt()}>
          Type to search every workspace you can read. Matches where you are come first.
        </p>
      )
    }
    if (invalid !== undefined) return <InvalidQueryNotice query={typed} invalid={invalid} />
    if (results.isError) {
      return (
        <p role="alert" className={styles.prompt()}>
          Search is not answering right now. Try again in a moment.
        </p>
      )
    }
    // Only once an answer for *this* query has actually arrived: the previous
    // answer is kept on screen while the next is fetched, and saying "nothing
    // matched" over results that are merely stale would be a lie for 200 ms.
    if (groups.length === 0 && !results.isPending && !results.isFetching) {
      return <p className={styles.prompt()}>Nothing matched “{typed}”.</p>
    }
    return undefined
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
        {workspace === undefined || typed === '' ? undefined : (
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
