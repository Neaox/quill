import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { Callout, ChevronRightIcon, Spinner, textLinkClassName, tv } from '@quill/ui'

import { useMe, useWorkspaceList, type WorkspaceSummaryDto } from '../../lib/api/index.ts'
import { now } from '../../lib/time/clock.ts'
import { relativeTime } from '../../lib/time/relative-time.ts'
import { ORGANISATION_DESTINATIONS } from '../admin/organisation-destinations.ts'
import { AppPage } from '../layout/app-page.tsx'
import { SearchField } from '../search/search-field.tsx'
import { SetupChecklist } from './setup-checklist.tsx'
import {
  useHomeSections,
  type HomeDocument,
  type HomeSections,
  type HomeWorkspace,
} from './use-home-sections.ts'

export const homePageStyles = tv({
  slots: {
    intro: 'flex flex-col gap-5',
    // The field keeps to a comfortable reading width on a wide window
    // rather than stretching across the whole dashboard.
    search: 'max-w-2xl',
    /*
     * Two columns from `lg`: the long lists (set-up, what changed) on the
     * left, the short ones (unfinished work, where to go, the organisation)
     * on the right, so neither column runs on while the other stands empty
     * and a wide window is used as one composition (`AppPage` caps it).
     *
     * On a phone the columns dissolve (`contents`) and every section becomes
     * one item of a single column, in the order a person needs them:
     * set-up, unfinished work, where to go, what changed, the organisation.
     */
    board: [
      'flex flex-col gap-10',
      'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)] lg:items-start lg:gap-x-12',
      '2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
    ],
    column: 'flex flex-col gap-10 max-lg:contents',
    checklist: 'max-lg:order-1',
    drafts: 'max-lg:order-2',
    workspaces: 'max-lg:order-3',
    recent: 'max-lg:order-4',
    organisation: 'max-lg:order-5',
    eyebrow: 'text-sm text-muted',
    greeting: 'mt-1 text-2xl font-semibold tracking-tight text-balance text-foreground',
    sectionHead: 'flex items-baseline gap-1.5',
    sectionTitle: 'section-label text-sm',
    sectionCount: 'section-count text-sm tabular-nums',
    sectionNote: 'mt-1 text-xs text-muted',
    // A container, so a row drops its workspace name by the room the list
    // has rather than the window's: the same list sits in a wide column and
    // in a narrow one.
    list: 'mt-3 flex flex-col @container',
    row: [
      'group -mx-2.5 flex items-center gap-4 rounded-md px-2.5 py-2 text-sm',
      'transition-colors ease-standard hover:bg-surface',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    rowTitle: 'min-w-0 grow truncate font-medium text-foreground',
    rowMeta: 'flex shrink-0 items-center gap-2 text-xs text-muted tabular-nums',
    rowWorkspace: 'hidden max-w-40 truncate @sm:block',
    cards: 'mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1',
    card: [
      'group flex h-full flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4',
      'shadow-raised transition-colors ease-standard hover:border-border-strong',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    cardHead: 'flex items-start justify-between gap-3',
    cardName: 'block truncate font-medium text-foreground',
    cardUnit: 'mt-0.5 block truncate text-xs text-muted',
    cardArrow: [
      'mt-0.5 text-muted transition-transform ease-standard',
      'group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none',
    ],
    cardFacts: 'mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted tabular-nums',
    destinations: [
      'mt-3 flex flex-col divide-y divide-border rounded-lg border border-border',
      'bg-surface-raised shadow-raised',
    ],
    destination: [
      'group flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-foreground',
      'transition-colors ease-standard hover:bg-surface',
      'in-first:rounded-t-lg in-last:rounded-b-lg',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
})

/** Today, the way the greeting's line above it says it: "Sunday 11 October". */
const TODAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

/** The same day as a `<time datetime>`, on the reader's clock rather than UTC's. */
const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** What the greeting says, by the hour of the day on the reader's own clock. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * The signed-in home (`docs/design/home.md`): the person is the subject, not
 * a workspace. In order, each part omitted when it has nothing to say rather
 * than shown blank:
 *
 * 1. Who and when: the date and a greeting. The organisation's name is
 *    already in the bar above.
 * 2. Search, the page's first action: the palette also lists every place to
 *    go, so it is how anything is reached from here.
 * 3. The set-up checklist, for an administrator, until the instance is set up.
 * 4. Continue writing: drafts that have never been published.
 * 5. Workspaces, as cards with what is in each.
 * 6. Recently updated: the newest published changes.
 * 7. Organisation, for an administrator: every settings screen, the same
 *    list the person menu and the palette offer.
 *
 * A person with exactly one workspace never sees this page: the route sends
 * them straight into it.
 */
export function HomePage() {
  const me = useMe()
  const workspaces = useWorkspaceList()
  const sections = useHomeSections(workspaces.data ?? [])
  // Captured once: the greeting and the "3 days ago"s do not tick while
  // somebody reads them (`lib/time/clock.ts`).
  const [renderedAt] = useState(now)
  const styles = homePageStyles()
  const isInstanceAdmin = me.data?.isInstanceAdmin === true
  const greeting = greetingFor(new Date(renderedAt).getHours())

  return (
    <AppPage width="full" brandLinksHome={false}>
      <div className={styles.intro()}>
        <div>
          <p className={styles.eyebrow()}>
            <time dateTime={LOCAL_DATE.format(renderedAt)}>{TODAY.format(renderedAt)}</time>
          </p>
          <h1 className={styles.greeting()}>
            {me.data === undefined ? 'Home' : `${greeting}, ${me.data.displayName}`}
          </h1>
        </div>
        <SearchField placement="page" className={styles.search()} />
      </div>

      {workspaces.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted" aria-busy="true">
          <Spinner /> Loading your workspaces
        </p>
      ) : workspaces.isError ? (
        <Callout tone="danger" title="Your workspaces could not be loaded">
          Reload the page to try again. If it keeps failing, tell your administrator.
        </Callout>
      ) : (
        <Board
          isInstanceAdmin={isInstanceAdmin}
          workspaces={workspaces.data}
          sections={sections}
          renderedAt={renderedAt}
        />
      )}
    </AppPage>
  )
}

function Board({
  isInstanceAdmin,
  workspaces,
  sections,
  renderedAt,
}: {
  readonly isInstanceAdmin: boolean
  readonly workspaces: readonly WorkspaceSummaryDto[]
  readonly sections: HomeSections
  readonly renderedAt: number
}) {
  const styles = homePageStyles()
  const hasWorkspace = workspaces.length > 0

  return (
    <div className={styles.board()}>
      <div className={styles.column()}>
        {isInstanceAdmin ? (
          <SetupChecklist
            workspaces={workspaces}
            anyPublished={sections.anyPublished}
            className={styles.checklist()}
          />
        ) : undefined}
        {hasWorkspace ? (
          <RecentlyUpdated
            sections={sections}
            renderedAt={renderedAt}
            className={styles.recent()}
          />
        ) : (
          <NoWorkspaces isInstanceAdmin={isInstanceAdmin} className={styles.recent()} />
        )}
      </div>

      <div className={styles.column()}>
        {sections.continueWith.length === 0 ? undefined : (
          <HomeSection
            id="continue"
            className={styles.drafts()}
            title="Continue writing"
            count={sections.draftTotal}
            note="Drafts that have never been published, newest first."
          >
            <DocumentList documents={sections.continueWith} renderedAt={renderedAt} />
          </HomeSection>
        )}
        {hasWorkspace ? (
          <HomeSection
            id="your-workspaces"
            className={styles.workspaces()}
            title="Workspaces"
            count={sections.workspaces.length}
          >
            <ul className={styles.cards()}>
              {sections.workspaces.map((card) => (
                <li key={card.workspace.id}>
                  <WorkspaceCard card={card} renderedAt={renderedAt} />
                </li>
              ))}
            </ul>
          </HomeSection>
        ) : undefined}
        {isInstanceAdmin ? <OrganisationLinks className={styles.organisation()} /> : undefined}
      </div>
    </div>
  )
}

function RecentlyUpdated({
  sections,
  renderedAt,
  className,
}: {
  readonly sections: HomeSections
  readonly renderedAt: number
  readonly className: string
}) {
  if (sections.recentlyUpdated.length > 0) {
    return (
      <HomeSection
        id="recently-updated"
        className={className}
        title="Recently updated"
        note="The newest published changes across your workspaces."
      >
        <DocumentList documents={sections.recentlyUpdated} renderedAt={renderedAt} />
      </HomeSection>
    )
  }
  // Never "nothing yet" while the lists are still arriving.
  return sections.isPending ? undefined : (
    <HomeSection id="recently-updated" className={className} title="Recently updated">
      <p className="mt-2 text-sm text-muted">
        Nothing has been published yet. Published documents appear here, newest first.
      </p>
    </HomeSection>
  )
}

/** Every organisation settings screen, for an administrator: the person menu's list, in place. */
function OrganisationLinks({ className }: { readonly className: string }) {
  const styles = homePageStyles()

  return (
    <HomeSection id="organisation" className={className} title="Organisation">
      <ul className={styles.destinations()}>
        {ORGANISATION_DESTINATIONS.map((destination) => (
          <li key={destination.to}>
            <Link to={destination.to} className={styles.destination()}>
              {destination.label}
              <ChevronRightIcon className={styles.cardArrow()} />
            </Link>
          </li>
        ))}
      </ul>
    </HomeSection>
  )
}

function HomeSection({
  id,
  className,
  title,
  count,
  note,
  children,
}: {
  readonly id: string
  /** Where the section sits on the dashboard's grid. */
  readonly className: string
  readonly title: string
  readonly count?: number | undefined
  readonly note?: string | undefined
  readonly children: ReactNode
}) {
  const styles = homePageStyles()

  return (
    <section aria-labelledby={id} className={className}>
      <div className={styles.sectionHead()}>
        <h2 id={id} className={styles.sectionTitle()}>
          {title}
        </h2>
        {/* Beside the heading rather than in it: the heading is the
            section's name, and the count is a fact about it. */}
        {count === undefined ? undefined : <span className={styles.sectionCount()}>{count}</span>}
      </div>
      {note === undefined ? undefined : <p className={styles.sectionNote()}>{note}</p>}
      {children}
    </section>
  )
}

function DocumentList({
  documents,
  renderedAt,
}: {
  readonly documents: readonly HomeDocument[]
  readonly renderedAt: number
}) {
  const styles = homePageStyles()

  return (
    <ul className={styles.list()}>
      {documents.map((document) => (
        <li key={document.id}>
          <Link
            to="/w/$workspaceSlug/d/$documentId"
            params={{ workspaceSlug: document.workspaceSlug, documentId: document.reference }}
            search={{}}
            className={styles.row()}
          >
            <span className={styles.rowTitle()}>{document.title}</span>
            <span className={styles.rowMeta()}>
              <span className={styles.rowWorkspace()}>{document.workspaceName}</span>
              <time dateTime={document.updatedAt} title={document.updatedAt.slice(0, 10)}>
                {relativeTime(document.updatedAt, renderedAt)}
              </time>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function WorkspaceCard({
  card,
  renderedAt,
}: {
  readonly card: HomeWorkspace
  readonly renderedAt: number
}) {
  const styles = homePageStyles()
  const { workspace, documentCount, draftCount, updatedAt } = card

  return (
    <Link
      to="/w/$workspaceSlug"
      params={{ workspaceSlug: card.reference }}
      className={styles.card()}
    >
      <span className={styles.cardHead()}>
        <span className="min-w-0">
          <span className={styles.cardName()}>{workspace.name}</span>
          <span className={styles.cardUnit()}>{workspace.unit.path.join(' / ')}</span>
        </span>
        <ChevronRightIcon className={styles.cardArrow()} />
      </span>
      {documentCount === undefined ? undefined : (
        <span className={styles.cardFacts()}>
          <span>{plural(documentCount, 'document')}</span>
          {draftCount === undefined || draftCount === 0 ? undefined : (
            <span>{plural(draftCount, 'draft')}</span>
          )}
          {updatedAt === undefined ? undefined : (
            <span>
              Updated <time dateTime={updatedAt}>{relativeTime(updatedAt, renderedAt)}</time>
            </span>
          )}
        </span>
      )}
    </Link>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function NoWorkspaces({
  isInstanceAdmin,
  className,
}: {
  readonly isInstanceAdmin: boolean
  readonly className: string
}) {
  return isInstanceAdmin ? (
    <Callout tone="info" title="No workspaces yet" className={className}>
      Nothing has been set up. Create the first unit and workspace in{' '}
      <Link to="/admin/organisation" className={textLinkClassName()}>
        Units and workspaces
      </Link>
      .
    </Callout>
  ) : (
    <Callout tone="info" title="No workspaces yet" className={className}>
      You have not been given access to a workspace. Ask an administrator of your organisation to
      add you to one.
    </Callout>
  )
}
