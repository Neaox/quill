import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, ChevronRightIcon, RelativeTime, SearchIcon, tv, VirtualRows } from '@quill/ui'

import type { HomeWorkspace } from './use-home-sections.ts'

/** Above this many workspaces the list starts as the few most active, not all of them. */
export const COLLAPSE_ABOVE = 12

/** How many of the most active workspaces the collapsed list shows. */
export const PREVIEW_COUNT = 8

/** From this many workspaces up, finding one is quicker by typing than by looking. */
export const FILTER_FROM = 8

/**
 * From this many entries (workspaces and unit headings) the grouped list is drawn as a window
 * onto its rows instead of all at once: a few dozen cost nothing, and a few thousand must not
 * become a few thousand elements.
 */
export const VIRTUALISE_FROM = 60

/** A unit's heading and a workspace's row, in pixels: fixed, so the window needs no measuring. */
const UNIT_ROW_HEIGHT = 36
const PLACE_ROW_HEIGHT = 48

type Entry =
  | { readonly kind: 'unit'; readonly unit: string }
  | { readonly kind: 'place'; readonly card: HomeWorkspace }

export const workspacePlacesStyles = tv({
  slots: {
    root: 'mt-3 flex flex-col gap-3 @container',
    filter: 'relative',
    filterIcon:
      'pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted',
    filterInput: [
      'h-8 w-full rounded-md border border-border bg-surface-raised ps-8 pe-2.5 text-xs text-foreground',
      'transition-[border-color] ease-standard placeholder:text-muted/75 hover:border-border-strong',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    unitHead: 'mt-5 px-2.5 text-xs font-medium text-muted first:mt-0',
    list: 'mt-1 flex flex-col',
    place: [
      'group flex items-center gap-3 rounded-md px-2.5 py-2',
      'transition-colors ease-standard hover:bg-surface',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    monogram: [
      'grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface',
      'text-xs font-semibold text-foreground-soft transition-colors ease-standard',
      'group-hover:border-border-strong group-hover:text-foreground',
    ],
    names: 'flex min-w-0 grow flex-col',
    name: 'truncate text-sm font-medium text-foreground',
    unit: 'truncate text-xs text-muted',
    facts: 'flex shrink-0 items-center gap-2.5 text-xs text-muted tabular-nums',
    when: 'hidden @md:inline',
    drafts: 'font-medium text-accent-ink',
    arrow: [
      'size-3.5 text-muted opacity-0 transition ease-standard',
      'group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none',
    ],
    note: 'px-2.5 text-sm text-muted',
    footer: 'flex',
  },
})

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function unitPath(card: HomeWorkspace): string {
  return card.workspace.unit.path.join(' / ')
}

/**
 * The ones this person is likeliest to want, first: where they have been and written lately, then
 * where anything changed most recently. For somebody with no history it is the second alone.
 */
function mostRelevant(cards: readonly HomeWorkspace[]): HomeWorkspace[] {
  return cards.toSorted(
    (a, b) => b.engagement - a.engagement || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )
}

/**
 * Every workspace the person can reach, at whatever scale.
 *
 * - **A few** (up to `COLLAPSE_ABOVE`): one flat list in the order the server
 *   gave, each row naming its unit when the workspaces are not all in one.
 *   Grouping three workspaces under three headings is furniture.
 * - **Many**: the `PREVIEW_COUNT` most relevant to them, because that is the
 *   part of a large organisation a person actually returns to, with a way to
 *   open the whole list, grouped under the unit that holds each.
 * - **Typing** in the filter (shown from `FILTER_FROM` up) searches all of
 *   them, by name or unit, and lists the matches grouped when there are many.
 */
export function WorkspacePlaces({ cards }: { readonly cards: readonly HomeWorkspace[] }) {
  const styles = workspacePlacesStyles()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const needle = query.trim().toLocaleLowerCase()
  const filtering = needle !== ''
  const collapsible = cards.length > COLLAPSE_ABOVE
  // Where the person has a history, theirs come first even in a short list; where they have
  // none the server's order, which is the organisation's, stands.
  const ordered = cards.some((card) => card.engagement > 0) ? mostRelevant(cards) : cards
  const matches = filtering
    ? cards.filter((card) =>
        `${card.workspace.name} ${unitPath(card)}`.toLocaleLowerCase().includes(needle),
      )
    : ordered
  const grouped = collapsible && (expanded || filtering)
  const shown = collapsible && !grouped ? mostRelevant(cards).slice(0, PREVIEW_COUNT) : matches

  return (
    <div className={styles.root()}>
      {cards.length < FILTER_FROM ? undefined : (
        <div className={styles.filter()}>
          <SearchIcon className={styles.filterIcon()} />
          <input
            type="search"
            aria-label="Filter workspaces"
            placeholder="Filter workspaces"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            className={styles.filterInput()}
          />
        </div>
      )}

      {filtering && matches.length === 0 ? (
        <p role="status" className={styles.note()}>
          No workspace matches “{query.trim()}”.
        </p>
      ) : grouped ? (
        <GroupedList cards={shown} />
      ) : (
        <List cards={shown} showUnit={new Set(shown.map(unitPath)).size > 1} />
      )}

      {!collapsible || filtering ? undefined : (
        <div className={styles.footer()}>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(!expanded)
            }}
          >
            {expanded ? 'Show fewer' : `Show all ${cards.length} workspaces`}
          </Button>
        </div>
      )}
    </div>
  )
}

function GroupedList({ cards }: { readonly cards: readonly HomeWorkspace[] }) {
  const styles = workspacePlacesStyles()
  const groups = Object.entries(Object.groupBy(cards, unitPath))

  if (cards.length + groups.length < VIRTUALISE_FROM) {
    return (
      <div>
        {groups.map(([unit, members]) => (
          <section key={unit} aria-label={unit}>
            <h3 className={styles.unitHead()}>{unit}</h3>
            <List cards={members ?? []} showUnit={false} />
          </section>
        ))}
      </div>
    )
  }

  const entries = groups.flatMap(([unit, members]): Entry[] => [
    { kind: 'unit', unit },
    ...(members ?? []).map((card): Entry => ({ kind: 'place', card })),
  ])
  return (
    <VirtualRows
      label="Workspaces by unit"
      rows={entries}
      rowKey={(entry) => (entry.kind === 'unit' ? `unit:${entry.unit}` : entry.card.workspace.id)}
      rowHeight={(entry) => (entry.kind === 'unit' ? UNIT_ROW_HEIGHT : PLACE_ROW_HEIGHT)}
      renderRow={(entry) =>
        entry.kind === 'unit' ? (
          <h3 className={styles.unitHead({ className: 'mt-0 pt-4' })}>{entry.unit}</h3>
        ) : (
          <Place card={entry.card} showUnit={false} fixedHeight />
        )
      }
      className="max-h-[min(36rem,70vh)]"
    />
  )
}

function List({
  cards,
  showUnit,
}: {
  readonly cards: readonly HomeWorkspace[]
  readonly showUnit: boolean
}) {
  const styles = workspacePlacesStyles()

  return (
    <ul className={styles.list()}>
      {cards.map((card) => (
        <li key={card.workspace.id}>
          <Place card={card} showUnit={showUnit} />
        </li>
      ))}
    </ul>
  )
}

function Place({
  card,
  showUnit,
  fixedHeight = false,
}: {
  readonly card: HomeWorkspace
  readonly showUnit: boolean
  /** Drawn in a window, which places it by a height it was told rather than one it measures. */
  readonly fixedHeight?: boolean
}) {
  const styles = workspacePlacesStyles()
  const { workspace, documentCount, draftCount, updatedAt } = card

  return (
    <Link
      to="/w/$workspaceSlug"
      params={{ workspaceSlug: card.reference }}
      className={styles.place({ className: fixedHeight ? 'h-12 py-0' : undefined })}
    >
      <span className={styles.monogram()} aria-hidden="true">
        {Array.from(workspace.name.trim())[0]?.toUpperCase()}
      </span>
      <span className={styles.names()}>
        <span className={styles.name()}>{workspace.name}</span>
        {showUnit ? <span className={styles.unit()}>{unitPath(card)}</span> : undefined}
      </span>
      {documentCount === undefined ? undefined : (
        <span className={styles.facts()}>
          {draftCount === undefined || draftCount === 0 ? undefined : (
            <span className={styles.drafts()}>{plural(draftCount, 'draft')}</span>
          )}
          <span>{plural(documentCount, 'document')}</span>
          {updatedAt === undefined ? undefined : (
            <RelativeTime value={updatedAt} className={styles.when()} />
          )}
        </span>
      )}
      <ChevronRightIcon className={styles.arrow()} />
    </Link>
  )
}
