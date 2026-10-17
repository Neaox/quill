import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import {
  Button,
  Callout,
  DocumentIcon,
  LocalTime,
  RelativeTime,
  textLinkClassName,
  tv,
} from '@quill/ui'

import {
  useMe,
  useWorkspaceList,
  type HomeScope,
  type WorkspaceSummaryDto,
} from '../../lib/api/index.ts'
import { now } from '../../lib/time/clock.ts'
import { ORGANISATION_DESTINATIONS } from '../admin/organisation-destinations.ts'
import { AppPage } from '../layout/app-page.tsx'
import { SearchField } from '../search/search-field.tsx'
import { SegmentedControl } from '../theme/segmented-control.tsx'
import { groupByDay } from './group-by-day.ts'
import { SetupChecklist, useSetupChecklist, type SetupChecklistState } from './setup-checklist.tsx'
import {
  useHomeSections,
  type HomeAttention,
  type HomeDocument,
  type HomeSections,
} from './use-home-sections.ts'
import { WorkspacePlaces } from './workspace-places.tsx'

export const homePageStyles = tv({
  slots: {
    intro: 'flex flex-col gap-6',
    // The field keeps to a comfortable reading width on a wide window
    // rather than stretching across the whole dashboard.
    search: 'max-w-2xl',
    /*
     * The page reads top to bottom as the person's day does: set-up (until
     * done), the work they left unfinished, then what changed beside where
     * they might go, and the organisation's settings last and quietest.
     *
     * From `lg` the last two sit side by side: the feed on the left, the
     * places on the right. On a phone they stack with places first, because
     * a short list of destinations beats a feed there.
     */
    board: 'flex flex-col gap-12',
    columns:
      'flex flex-col gap-12 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-x-14',
    feed: 'lg:col-start-1',
    places: 'max-lg:order-first lg:col-start-2 lg:row-start-1',
    eyebrow: 'text-sm text-muted',
    greeting:
      'mt-1 text-3xl font-semibold tracking-tight text-balance text-foreground max-sm:text-2xl',
    sectionHead: 'flex items-baseline gap-2',
    sectionTitle: 'section-label text-sm',
    sectionCount: 'section-count text-sm tabular-nums',
    // A container, so a row drops its workspace name by the room the list
    // has rather than the window's: the same list sits in a wide column and
    // in a narrow one.
    feedDays: 'mt-4 flex flex-col gap-5 @container',
    dayLabel: 'px-2.5 text-xs font-medium text-muted',
    dayList: 'mt-1 flex flex-col',
    row: [
      'group flex items-center gap-4 rounded-md px-2.5 py-2 text-sm',
      'transition-colors ease-standard hover:bg-surface',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    rowTitle: 'min-w-0 grow truncate font-medium text-foreground',
    rowMeta: 'flex shrink-0 items-center gap-3 text-xs text-muted tabular-nums',
    rowWorkspace: 'hidden max-w-40 truncate @md:block',
    jump: 'mt-3 flex flex-wrap gap-2',
    jumpLink: [
      'flex max-w-72 items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm',
      'transition-colors ease-standard hover:border-border-strong hover:bg-surface',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    // What is asked of the person, in the one place that is allowed to ask for attention: the
    // accent edge says "this is for you" and the rest of the page stays quiet.
    attention: 'mt-3 flex flex-col gap-2',
    attentionRow: [
      'flex items-center gap-4 rounded-md border border-border border-s-2 border-s-accent',
      'bg-surface-raised px-3 py-2.5 text-sm shadow-raised @container',
      'transition-colors ease-standard hover:border-border-strong hover:border-s-accent',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    attentionText: 'min-w-0 grow truncate text-foreground-soft',
    // Drafts are the person's own unfinished work, so they are the one place
    // on the page that is a card: it is the thing to pick back up.
    drafts: 'mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]',
    draft: [
      'group flex h-full min-h-28 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4',
      'shadow-raised transition-colors ease-standard hover:border-border-strong',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    draftIcon: 'size-4 text-muted transition-colors ease-standard group-hover:text-accent-ink',
    draftTitle: 'line-clamp-2 font-medium leading-snug text-balance text-foreground',
    draftMeta: 'mt-auto flex items-center gap-1.5 text-xs text-muted tabular-nums',
    // What stands where a list will be: said in a sentence, in a quiet frame
    // that holds the column's place so the page does not look broken.
    empty: [
      'mt-4 flex flex-col items-start gap-2 rounded-lg border border-dashed border-border',
      'px-4 py-5 text-sm text-muted',
    ],
    emptyTitle: 'font-medium text-foreground',
    destinations: 'mt-3 flex flex-wrap gap-2',
    destination: [
      'rounded-full border border-border px-3 py-1 text-sm text-foreground-soft',
      'transition-colors ease-standard hover:border-border-strong hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    skeleton: 'mt-4 flex flex-col gap-4',
    bar: 'block h-3.5 animate-pulse rounded-sm bg-surface motion-reduce:animate-none',
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
 * 4. Continue writing: drafts that have never been published, as cards.
 * 5. Recently updated: the newest published changes under the day they
 *    happened, beside Workspaces: every place, however many there are.
 * 6. Organisation, for an administrator: every settings screen as quiet
 *    links, the same list the person menu and the palette offer.
 *
 * It holds for an organisation of any size because what it shows is bounded by
 * the server (`GET /api/home`), and for an empty instance because every part
 * has a state of its own: bars while loading, a sentence and a way forward
 * when there is nothing, and a retry when a part fails.
 *
 * A person with exactly one workspace never sees this page: the route sends
 * them straight into it.
 */
export function HomePage() {
  const me = useMe()
  const workspaces = useWorkspaceList()
  // Undefined until the person chooses: the server picks the sensible one for their history.
  const [scope, setScope] = useState<HomeScope | undefined>(undefined)
  const sections = useHomeSections(workspaces.data ?? [], scope)
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
        <HomeSkeleton />
      ) : workspaces.isError ? (
        <Callout tone="danger" title="Your workspaces could not be loaded">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Something went wrong reaching the server.
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void workspaces.refetch()
              }}
            >
              Try again
            </Button>
          </span>
        </Callout>
      ) : isInstanceAdmin ? (
        <AdministratorBoard
          workspaces={workspaces.data}
          sections={sections}
          renderedAt={renderedAt}
          onScope={setScope}
        />
      ) : (
        <Board
          workspaces={workspaces.data}
          sections={sections}
          renderedAt={renderedAt}
          onScope={setScope}
          setup={undefined}
        />
      )}
    </AppPage>
  )
}

/** The board with the administrator's set-up checklist, which needs its own state. */
function AdministratorBoard(props: {
  readonly workspaces: readonly WorkspaceSummaryDto[]
  readonly sections: HomeSections
  readonly renderedAt: number
  readonly onScope: (scope: HomeScope) => void
}) {
  const { sections } = props
  const setup = useSetupChecklist(
    props.workspaces,
    sections.anyPublished,
    sections.isPending || sections.isError ? 'unknown' : 'known',
  )
  return <Board {...props} setup={setup} />
}

function Board({
  workspaces,
  sections,
  renderedAt,
  onScope,
  setup,
}: {
  readonly workspaces: readonly WorkspaceSummaryDto[]
  readonly sections: HomeSections
  readonly renderedAt: number
  readonly onScope: (scope: HomeScope) => void
  /** Present for an administrator only. */
  readonly setup: SetupChecklistState | undefined
}) {
  const styles = homePageStyles()
  const shownDrafts = sections.continueWith.length

  return (
    <div className={styles.board()}>
      {setup === undefined ? undefined : <SetupChecklist setup={setup} workspaces={workspaces} />}
      {sections.attention.length === 0 ? undefined : (
        <HomeSection id="attention" title="Needs your attention" count={sections.attention.length}>
          <ul className={styles.attention()}>
            {sections.attention.map((item) => (
              <li key={item.requestId + item.kind}>
                <AttentionRow item={item} />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}
      {shownDrafts === 0 ? undefined : (
        <HomeSection
          id="continue"
          title="Continue writing"
          count={
            sections.draftTotal > shownDrafts
              ? `${shownDrafts} of ${sections.draftTotal}`
              : sections.draftTotal
          }
        >
          <ul className={styles.drafts()}>
            {sections.continueWith.map((document) => (
              <li key={document.id}>
                <DraftCard document={document} />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}
      {sections.jumpBackIn.length === 0 ? undefined : (
        <HomeSection id="jump-back-in" title="Jump back in">
          <ul className={styles.jump()}>
            {sections.jumpBackIn.map((document) => (
              <li key={document.id}>
                <JumpLink document={document} />
              </li>
            ))}
          </ul>
        </HomeSection>
      )}
      {workspaces.length > 0 ? (
        <div className={styles.columns()}>
          <RecentlyUpdated
            sections={sections}
            renderedAt={renderedAt}
            onScope={onScope}
            className={styles.feed()}
          />
          <HomeSection
            id="your-workspaces"
            className={styles.places()}
            title="Workspaces"
            count={sections.workspaces.length}
          >
            <WorkspacePlaces cards={sections.workspaces} />
          </HomeSection>
        </div>
      ) : // The checklist already says there is no workspace, and how to make one.
      setup?.visible === true ? undefined : (
        <NoWorkspaces isInstanceAdmin={setup !== undefined} />
      )}
      {setup === undefined ? undefined : <OrganisationLinks />}
    </div>
  )
}

function RecentlyUpdated({
  sections,
  renderedAt,
  onScope,
  className,
}: {
  readonly sections: HomeSections
  readonly renderedAt: number
  readonly onScope: (scope: HomeScope) => void
  readonly className: string
}) {
  const styles = homePageStyles()
  const choosing = sections.hasHistory && sections.scope !== undefined

  return (
    <HomeSection
      id="recently-updated"
      className={className}
      title="Recently updated"
      action={
        choosing ? (
          <SegmentedControl
            legend="Which places"
            segments={SCOPES}
            value={sections.scope}
            onValueChange={onScope}
          />
        ) : undefined
      }
    >
      {sections.recentlyUpdated.length > 0 ? (
        <div className={styles.feedDays()}>
          {groupByDay(sections.recentlyUpdated, (row) => row.updatedAt, renderedAt).map((day) => (
            <section key={day.label} aria-label={day.label}>
              <h3 className={styles.dayLabel()}>{day.label}</h3>
              <ul className={styles.dayList()}>
                {day.items.map((document) => (
                  <li key={document.id}>
                    <FeedRow document={document} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : sections.isPending ? (
        <FeedSkeleton />
      ) : sections.isError ? (
        <div className={styles.empty()}>
          <p className={styles.emptyTitle()}>Recent changes could not be loaded</p>
          <Button size="sm" variant="secondary" onClick={sections.retry}>
            Try again
          </Button>
        </div>
      ) : sections.anyPublished && sections.scope === 'mine' ? (
        <div className={styles.empty()}>
          <p className={styles.emptyTitle()}>Nothing new in your places</p>
          <p>Nobody else has published in the workspaces you work in lately.</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onScope('everywhere')
            }}
          >
            Show everywhere
          </Button>
        </div>
      ) : (
        <div className={styles.empty()}>
          <p className={styles.emptyTitle()}>Nothing has been published yet</p>
          <p>Published documents appear here, newest first, under the day they changed.</p>
        </div>
      )}
    </HomeSection>
  )
}

/** Every organisation settings screen, for an administrator: the person menu's list, in place. */
function OrganisationLinks() {
  const styles = homePageStyles()

  return (
    <HomeSection id="organisation" title="Organisation">
      <ul className={styles.destinations()}>
        {ORGANISATION_DESTINATIONS.map((destination) => (
          <li key={destination.to}>
            <Link to={destination.to} className={styles.destination()}>
              {destination.label}
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
  action,
  children,
}: {
  readonly id: string
  /** Where the section sits on the dashboard's grid. */
  readonly className?: string | undefined
  readonly title: string
  readonly count?: number | string | undefined
  /** Beside the heading, at the end of its line: a control that changes what the section shows. */
  readonly action?: ReactNode
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
        {action === undefined ? undefined : <div className="ms-auto self-center">{action}</div>}
      </div>
      {children}
    </section>
  )
}

const SCOPES = [
  { value: 'mine', label: 'Your places' },
  { value: 'everywhere', label: 'Everywhere' },
] as const

/** A document the person was just in: a small way back, because "again" is what they want. */
function JumpLink({ document }: { readonly document: HomeDocument }) {
  const styles = homePageStyles()

  return (
    <Link
      to="/w/$workspaceSlug/d/$documentId"
      params={{ workspaceSlug: document.workspaceSlug, documentId: document.reference }}
      search={{}}
      className={styles.jumpLink()}
    >
      <DocumentIcon className="size-3.5 shrink-0 text-muted" />
      <span className="truncate font-medium text-foreground">{document.title}</span>
      <span className="hidden shrink-0 text-xs text-muted sm:inline">{document.workspaceName}</span>
    </Link>
  )
}

const ATTENTION_VERB: Record<HomeAttention['kind'], string> = {
  'review-requested': 'asked you to review',
  'changes-requested': 'asked for changes to',
  'review-approved': 'approved',
}

/** One thing waiting on the person, said as a sentence: who, what they ask, and of which document. */
function AttentionRow({ item }: { readonly item: HomeAttention }) {
  const styles = homePageStyles()
  const { document } = item

  return (
    <Link
      to="/w/$workspaceSlug/d/$documentId"
      params={{ workspaceSlug: document.workspaceSlug, documentId: document.reference }}
      search={{}}
      className={styles.attentionRow()}
    >
      <span className={styles.attentionText()}>
        {item.by} {ATTENTION_VERB[item.kind]}{' '}
        <strong className="font-semibold text-foreground">{document.title}</strong>
      </span>
      <span className={styles.rowMeta()}>
        <span className={styles.rowWorkspace()}>{document.workspaceName}</span>
        <RelativeTime value={item.at} />
      </span>
    </Link>
  )
}

/** A draft to pick back up: a card, because it is the one thing here that is yours. */
function DraftCard({ document }: { readonly document: HomeDocument }) {
  const styles = homePageStyles()

  return (
    <Link
      to="/w/$workspaceSlug/d/$documentId"
      params={{ workspaceSlug: document.workspaceSlug, documentId: document.reference }}
      search={{}}
      className={styles.draft()}
    >
      <DocumentIcon className={styles.draftIcon()} />
      <span className={styles.draftTitle()}>{document.title}</span>
      <span className={styles.draftMeta()}>
        <span className="truncate">{document.workspaceName}</span>
        <span aria-hidden="true">·</span>
        <RelativeTime value={document.updatedAt} className="shrink-0" />
      </span>
    </Link>
  )
}

/** One change in the feed: its day is the heading above, so only the time of day is said. */
function FeedRow({ document }: { readonly document: HomeDocument }) {
  const styles = homePageStyles()

  return (
    <Link
      to="/w/$workspaceSlug/d/$documentId"
      params={{ workspaceSlug: document.workspaceSlug, documentId: document.reference }}
      search={{}}
      className={styles.row()}
    >
      <span className={styles.rowTitle()}>{document.title}</span>
      <span className={styles.rowMeta()}>
        <span className={styles.rowWorkspace()}>{document.workspaceName}</span>
        <LocalTime value={document.updatedAt} format="time" />
      </span>
    </Link>
  )
}

/** Differing widths, so the placeholder reads as text rather than as a block. */
const FEED_BARS = [
  ['a', 'w-2/3'],
  ['b', 'w-1/2'],
  ['c', 'w-3/4'],
  ['d', 'w-3/5'],
  ['e', 'w-1/2'],
] as const

/** Bars where the feed's rows will be, so the page holds its shape while it loads. */
function FeedSkeleton() {
  const styles = homePageStyles()

  return (
    <div className={styles.skeleton({ className: 'px-2.5' })} aria-hidden="true">
      {FEED_BARS.map(([key, width]) => (
        <span key={key} className={styles.bar({ className: width })} />
      ))}
    </div>
  )
}

/** The page's shape while the workspaces load: announced once, drawn as bars. */
function HomeSkeleton() {
  const styles = homePageStyles()

  return (
    <div className={styles.columns()} aria-busy="true">
      <p className="sr-only" role="status">
        Loading your workspaces
      </p>
      <div className={styles.feed()}>
        <FeedSkeleton />
      </div>
      <div className={styles.places()} aria-hidden="true">
        <div className={styles.skeleton()}>
          {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
            <span key={key} className={styles.bar({ className: 'h-8 w-full' })} />
          ))}
        </div>
      </div>
    </div>
  )
}

function NoWorkspaces({ isInstanceAdmin }: { readonly isInstanceAdmin: boolean }) {
  return isInstanceAdmin ? (
    <Callout tone="info" title="No workspaces yet">
      Nothing has been set up. Create the first unit and workspace in{' '}
      <Link to="/admin/organisation" className={textLinkClassName()}>
        Units and workspaces
      </Link>
      .
    </Callout>
  ) : (
    <Callout tone="info" title="No workspaces yet">
      You have not been given access to a workspace. Ask an administrator of your organisation to
      add you to one.
    </Callout>
  )
}
