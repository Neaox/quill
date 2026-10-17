import { Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  Block,
  Button,
  buttonClassName,
  Callout,
  ChevronDownIcon,
  ChevronUpIcon,
  LayoutGrid,
  LinkIcon,
  RestoreIcon,
  RevisionPicker,
  Spinner,
  SwapIcon,
  toast,
  tv,
  type RevisionChoice,
} from '@quill/ui'

import {
  ApiError,
  DRAFT_SIDE,
  useComparison,
  useDocumentLinksLoader,
  useSourceComparison,
  type Comparison,
  type ComparisonChange,
  type ComparisonRange,
} from '../../../lib/api/index.ts'
import type { LabelledRevision } from '../../../lib/documents/revision-labels.ts'
import {
  comparisonLink,
  documentLink,
  type ComparisonLayout,
  type ComparisonView,
} from '../../../lib/routing/document-reference.ts'
import { useFollowLink } from '../../../lib/routing/use-follow-link.ts'
import { SegmentedControl } from '../../theme/segmented-control.tsx'
import { ShellAside } from '../../workspaces/shell-slots.tsx'
import { DocumentBody } from '../document-body.tsx'
import { RestoreRevisionDialog } from '../restore-revision-dialog.tsx'
import { enhanceComparison, type ComparisonSurface } from './comparison-surface.ts'
import { blockName, changeName, comparisonTitle, sideLabel, summarise } from './comparison-words.ts'
import { foldSource } from './source-hunks.ts'
import { SourceViewPanel } from './source-view.tsx'

export const comparisonPageStyles = tv({
  slots: {
    header: 'flex flex-col gap-5 pt-8 pb-6',
    back: [
      'w-fit text-xs font-medium text-muted transition-colors hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    eyebrow: 'text-2xs font-medium tracking-caps text-accent-ink uppercase',
    title:
      'text-2xl leading-tight font-semibold tracking-tight text-balance text-foreground sm:text-3xl',
    toolbar: 'flex flex-wrap items-end gap-x-3 gap-y-3',
    pickers: 'flex min-w-0 flex-wrap items-center gap-2',
    swap: 'size-10 shrink-0 justify-center px-0',
    quick: 'flex flex-wrap items-center gap-1 text-xs',
    quickLink: buttonClassName({ variant: 'ghost', size: 'sm', className: 'text-foreground-soft' }),
    actions: 'flex flex-wrap items-center gap-2 sm:ms-auto',
    summary: [
      'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border',
      'bg-surface-raised px-4 py-3 shadow-xs',
      // Focus lands here only from script (`tabIndex={-1}`), when a comparison
      // arrives, so a screen reader starts at the summary. No key reaches it,
      // so there is no keyboard position to show, and a ring here read as an
      // error on load.
      'focus:outline-hidden',
    ],
    summaryText: 'text-sm font-medium text-foreground tabular-nums',
    stepper: 'flex items-center gap-1.5 text-xs text-muted tabular-nums',
    kbd: 'rounded-sm border border-border bg-surface px-1 font-mono text-2xs text-foreground-soft',
    properties: 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs',
    propertyName: 'font-medium text-foreground-soft',
    propertyValue: 'flex flex-wrap items-baseline gap-1.5 text-foreground',
    body: 'pb-24',
    centre: 'flex min-h-60 items-center justify-center',
    rail: 'flex flex-col gap-8',
    railHeading: 'section-label pb-2.5',
    changeList: 'flex flex-col gap-0.5',
    change: [
      'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-start text-xs',
      'transition-colors ease-standard hover:bg-surface',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
      'current:bg-surface',
    ],
    // The kind and the block never break; the section, set apart by its
    // colour rather than a dot that would lead a wrapped line, follows them or
    // wraps under them when the rail is too narrow, never cut to a few letters.
    changeHead: 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-medium text-foreground',
    changeSection: 'min-w-0 font-normal text-muted',
    badge: [
      'rounded-sm px-1 text-2xs font-medium whitespace-nowrap',
      'data-[change=added]:bg-success-subtle data-[change=removed]:bg-danger-subtle',
      'data-[change=changed]:bg-warning-subtle data-[change=moved]:bg-accent-subtle',
    ],
    changeText: 'line-clamp-2 text-muted',
    sectionList: 'flex flex-col border-s border-border text-xs leading-snug',
    section: [
      '-ms-px flex items-baseline justify-between gap-2 border-s border-transparent py-1 ps-3',
      'text-muted transition-colors hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'data-[changed=true]:border-warning data-[changed=true]:text-foreground',
    ],
    sectionCount: 'shrink-0 text-2xs text-warning tabular-nums',
  },
  variants: {
    depth: { 1: { section: '' }, 2: { section: '' }, 3: { section: 'ps-6' } },
  },
})

export interface ComparisonPageProps {
  readonly documentId: string
  readonly workspaceSlug: string
  readonly title: string
  readonly revisions: readonly LabelledRevision[]
  readonly range: ComparisonRange
  readonly view: ComparisonView
  readonly layout: ComparisonLayout
  /** May edit: may compare with the draft, and restore (ADR-015). */
  readonly canEdit: boolean
}

const VIEWS = [
  { value: 'changes', label: 'Changes' },
  { value: 'source', label: 'Source' },
] as const satisfies readonly { value: ComparisonView; label: string }[]

const LAYOUTS = [
  { value: 'split', label: 'Side by side' },
  { value: 'unified', label: 'Unified' },
] as const satisfies readonly { value: ComparisonLayout; label: string }[]

/** A stable empty list, so the navigation's callbacks are not remade on every render. */
const NO_CHANGES: readonly ComparisonChange[] = []

/** The address of the page, as the reader would share it. */
async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.success('Link to this comparison copied')
  } catch {
    toast.danger('Copying was refused by the browser. Copy the address bar instead.')
  }
}

/** A revision as one of a picker's choices: who published it, when and why. */
function choice(revision: LabelledRevision, index: number): RevisionChoice {
  return {
    id: revision.revision,
    label: revision.label,
    at: revision.date,
    author: revision.authorName,
    note: revision.changeNote,
    ...(index === 0 ? { tag: 'Latest' } : {}),
  }
}

/** Keys that move between changes, as a reader of a review tool expects them. */
const NEXT_KEYS = new Set(['n', 'j'])
const PREVIOUS_KEYS = new Set(['p', 'k'])

/** Whether a key press belongs to something being typed into, or to a menu or dialog. */
function isBusyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="menu"], [role="dialog"], [role="listbox"]',
    ) !== null
  )
}

/**
 * Two versions of a document, compared (ADR-015; quill-plan.md, "history,
 * compare and restore").
 *
 * The default view is the document as readers see it, with insertions and
 * deletions marked in place, changed blocks flagged in the margin, unchanged
 * stretches folded, and pictures before and after. The source view shows the
 * Markdown line by line. Which two versions, which view and which layout are
 * all in the address (ADR-013), so a comparison can be linked to.
 *
 * Moving between changes is a summary's stepper, the list of changes beside
 * the page, and `n`/`p` (or `j`/`k`) from anywhere that is not a field. The
 * summary takes focus when a comparison arrives, so a screen reader starts at
 * what changed.
 */
export function ComparisonPage({
  documentId,
  workspaceSlug,
  title,
  revisions,
  range,
  view,
  layout,
  canEdit,
}: ComparisonPageProps) {
  const styles = comparisonPageStyles()
  const navigate = useNavigate()
  // A link in either version to another document moves within the app (ADR-035).
  const followLink = useFollowLink()
  const loadLinks = useDocumentLinksLoader()
  const comparison = useComparison(documentId, range)
  const source = useSourceComparison(documentId, range, { enabled: view === 'source' })
  const surface = useRef<ComparisonSurface | undefined>(undefined)
  const summaryRef = useRef<HTMLElement | null>(null)
  const sourceRef = useRef<HTMLDivElement | null>(null)
  const [current, setCurrent] = useState(-1)
  const [restoring, setRestoring] = useState<LabelledRevision | undefined>(undefined)

  const heading = comparisonTitle(revisions, range)
  const head = revisions[0]
  const changes = comparison.data?.changes ?? NO_CHANGES
  const hunks =
    view === 'source' && source.data !== undefined
      ? foldSource(source.data.lines).filter((part) => part.kind === 'hunk').length
      : 0
  const stops = view === 'changes' ? changes.length : hunks

  const enhance = useCallback((article: HTMLElement) => {
    const made = enhanceComparison(article)
    surface.current = made
    return () => {
      made.dispose()
      surface.current = undefined
    }
  }, [])

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= stops) return
      setCurrent(index)
      if (view === 'changes') {
        const change = changes[index]
        if (change !== undefined) surface.current?.goTo(change.id)
        return
      }
      // On a wide screen both layouts are in the page, one of them hidden;
      // the hunks to step through are the ones that are drawn.
      const rows = [
        ...(sourceRef.current?.querySelectorAll<HTMLElement>('[data-hunk]') ?? []),
      ].filter((element) => element.getClientRects().length > 0)
      const target = rows[index]
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target?.focus({ preventScroll: true })
    },
    [changes, stops, view],
  )

  /* Synchronises with the keyboard, which React does not own: `n` and `p`
     (and `j` and `k`) step through the changes from anywhere on the page
     that is not taking typed input. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || isBusyTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (NEXT_KEYS.has(key)) {
        event.preventDefault()
        goTo(Math.min(stops - 1, current + 1))
      } else if (PREVIOUS_KEYS.has(key)) {
        event.preventDefault()
        goTo(Math.max(0, current - 1))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [current, goTo, stops])

  const answer = comparison.data
  /* Synchronises the document's focus with the answer: when a comparison
     arrives, the summary of what changed is where reading starts. */
  useEffect(() => {
    if (answer !== undefined) summaryRef.current?.focus()
  }, [answer])

  function go(
    next: Partial<{
      from: string | null
      to: string
      view: ComparisonView
      layout: ComparisonLayout
    }>,
  ) {
    const from = next.from === undefined ? range.from : next.from
    setCurrent(-1)
    void navigate(
      comparisonLink(workspaceSlug, documentId, {
        ...(from === null ? {} : { from }),
        to: next.to ?? range.to,
        view: next.view ?? view,
        layout: next.layout ?? layout,
      }),
    )
  }

  const fromChoices = revisions.map((revision, index) => ({
    ...choice(revision, index),
    disabled: revision.revision === range.to,
  }))
  const toChoices: RevisionChoice[] = [
    ...(canEdit
      ? [{ id: DRAFT_SIDE, label: 'Your draft', tag: 'Draft', note: 'Not published yet' }]
      : []),
    ...revisions.map((revision, index) => ({
      ...choice(revision, index),
      disabled: revision.revision === range.from,
    })),
  ]

  const toIndex = revisions.findIndex((revision) => revision.revision === range.to)
  const previous =
    range.to === DRAFT_SIDE ? head : toIndex === -1 ? undefined : revisions[toIndex + 1]
  const canSwap = range.from !== null && range.to !== DRAFT_SIDE
  const restorable =
    canEdit && range.from !== null && range.from !== head?.revision
      ? revisions.find((revision) => revision.revision === range.from)
      : undefined

  return (
    <>
      <LayoutGrid>
        <Block width="wide" className={styles.header()}>
          <Link {...documentLink(workspaceSlug, documentId)} className={styles.back()}>
            <span aria-hidden="true">← </span>
            {title}
          </Link>
          <div className="flex flex-col gap-1.5">
            <p className={styles.eyebrow()}>Compare versions</p>
            <h1 className={styles.title()}>{heading}</h1>
          </div>

          <div className={styles.toolbar()}>
            <div role="group" aria-label="Versions to compare" className={styles.pickers()}>
              <RevisionPicker
                label="From"
                value={range.from ?? ''}
                choices={fromChoices}
                onValueChange={(from) => {
                  go({ from })
                }}
              />
              <Button
                variant="ghost"
                className={styles.swap()}
                disabled={!canSwap}
                title={canSwap ? 'Swap the two versions' : 'A draft is always the newer side'}
                aria-label="Swap the two versions"
                onClick={() => {
                  if (range.from !== null) go({ from: range.to, to: range.from })
                }}
              >
                <SwapIcon />
              </Button>
              <RevisionPicker
                label="To"
                value={range.to}
                choices={toChoices}
                onValueChange={(to) => {
                  go({ to })
                }}
              />
            </div>
            <div className={styles.actions()}>
              <SegmentedControl
                legend="Show"
                segments={VIEWS}
                value={view}
                onValueChange={(next) => {
                  go({ view: next })
                }}
              />
              {view === 'source' ? (
                <SegmentedControl
                  legend="Source layout"
                  segments={LAYOUTS}
                  value={layout}
                  onValueChange={(next) => {
                    go({ layout: next })
                  }}
                  className="max-md:hidden"
                />
              ) : undefined}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav aria-label="Quick comparisons" className={styles.quick()}>
              {previous === undefined ? undefined : (
                <Link
                  {...comparisonLink(workspaceSlug, documentId, {
                    from: previous.revision,
                    to: range.to,
                    view,
                    layout,
                  })}
                  className={styles.quickLink()}
                >
                  {`Previous version (${previous.label})`}
                </Link>
              )}
              {canEdit && head !== undefined ? (
                <Link
                  {...comparisonLink(workspaceSlug, documentId, {
                    from: head.revision,
                    to: DRAFT_SIDE,
                    view,
                    layout,
                  })}
                  className={styles.quickLink()}
                >
                  Published vs your draft
                </Link>
              ) : undefined}
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                iconStart={<LinkIcon />}
                onClick={() => void copyLink()}
              >
                Copy link
              </Button>
              {restorable === undefined ? undefined : (
                <Button
                  variant="secondary"
                  size="sm"
                  iconStart={<RestoreIcon />}
                  onClick={() => {
                    setRestoring(restorable)
                  }}
                >
                  {`Restore ${restorable.label}`}
                </Button>
              )}
            </div>
          </div>

          {comparison.data === undefined ? undefined : (
            <Summary
              summaryRef={summaryRef}
              comparison={comparison.data}
              heading={heading}
              current={current}
              stops={stops}
              onStep={goTo}
            />
          )}
        </Block>
      </LayoutGrid>

      {comparison.isPending ? (
        <div className={styles.centre()}>
          <Spinner className="size-5" />
        </div>
      ) : comparison.isError ? (
        <LayoutGrid>
          <Block width="wide">
            <Callout tone="danger" title="Couldn't compare these versions">
              {comparison.error instanceof ApiError
                ? comparison.error.message
                : 'Please try again.'}
            </Callout>
          </Block>
        </LayoutGrid>
      ) : view === 'source' ? (
        <div ref={sourceRef}>
          <SourceViewPanel query={source} layout={layout} caption={`${heading}, as Markdown`} />
        </div>
      ) : (
        <>
          {changes.length === 0 ? (
            <LayoutGrid className="pb-6">
              <Block width="wide">
                <Callout tone="info" title="No differences">
                  {`${sideLabel(revisions, range.from)} and ${sideLabel(revisions, range.to)} read the same.`}
                </Callout>
              </Block>
            </LayoutGrid>
          ) : undefined}
          <DocumentBody
            key={`${range.from ?? ''}:${range.to}`}
            html={comparison.data.html}
            label={heading}
            enhance={enhance}
            onFollowLink={followLink}
            loadLinks={loadLinks}
            className={styles.body()}
          />
        </>
      )}

      <ShellAside>
        <div className={styles.rail()}>
          {changes.length === 0 ? undefined : (
            <ChangeList
              changes={changes}
              current={view === 'changes' ? current : -1}
              onChoose={(index) => {
                if (view !== 'changes') go({ view: 'changes' })
                goTo(index)
              }}
            />
          )}
          {comparison.data === undefined || comparison.data.sections.length === 0 ? undefined : (
            <SectionList
              sections={comparison.data.sections}
              onChoose={(id) => {
                const target = document.getElementById(id)
                surface.current?.reveal(target)
                target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }}
            />
          )}
        </div>
      </ShellAside>

      <RestoreRevisionDialog
        documentId={documentId}
        workspaceSlug={workspaceSlug}
        revision={restoring}
        onClose={() => {
          setRestoring(undefined)
        }}
      />
    </>
  )
}

function Summary({
  summaryRef,
  comparison,
  heading,
  current,
  stops,
  onStep,
}: {
  readonly summaryRef: RefObject<HTMLElement | null>
  readonly comparison: Comparison
  readonly heading: string
  readonly current: number
  readonly stops: number
  readonly onStep: (index: number) => void
}) {
  const styles = comparisonPageStyles()
  return (
    <section
      ref={summaryRef}
      tabIndex={-1}
      aria-label={`Summary of ${heading}`}
      className={styles.summary()}
    >
      <div className="flex flex-col gap-1">
        <p className={styles.summaryText()}>{summarise(comparison.summary)}</p>
        {comparison.properties.length === 0 ? undefined : (
          <dl className={styles.properties()} aria-label="Properties changed">
            {comparison.properties.map((property) => (
              <div key={property.name} className="contents">
                <dt className={styles.propertyName()}>{property.name}</dt>
                <dd className={styles.propertyValue()}>
                  {property.before === undefined ? undefined : (
                    <del className="text-muted decoration-danger">{property.before}</del>
                  )}
                  {property.before === undefined || property.after === undefined ? undefined : (
                    <span aria-hidden="true">→</span>
                  )}
                  {property.after === undefined ? undefined : (
                    <ins className="no-underline">{property.after}</ins>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {stops === 0 ? undefined : (
        <div className={styles.stepper()}>
          <span aria-live="polite">
            {current < 0
              ? `${stops} ${stops === 1 ? 'change' : 'changes'}`
              : `Change ${current + 1} of ${stops}`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            iconStart={<ChevronUpIcon />}
            disabled={current <= 0}
            aria-keyshortcuts="p k"
            onClick={() => {
              onStep(current - 1)
            }}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconStart={<ChevronDownIcon />}
            disabled={current >= stops - 1}
            aria-keyshortcuts="n j"
            onClick={() => {
              onStep(current + 1)
            }}
          >
            Next
          </Button>
          <span className="max-sm:hidden" aria-hidden="true">
            <kbd className={styles.kbd()}>n</kbd> / <kbd className={styles.kbd()}>p</kbd>
          </span>
        </div>
      )}
    </section>
  )
}

function ChangeList({
  changes,
  current,
  onChoose,
}: {
  readonly changes: readonly ComparisonChange[]
  readonly current: number
  readonly onChoose: (index: number) => void
}) {
  const styles = comparisonPageStyles()
  return (
    <nav aria-labelledby="comparison-changes">
      <h2 id="comparison-changes" className={styles.railHeading()}>
        {`Changes (${changes.length})`}
      </h2>
      <ol className={styles.changeList()}>
        {changes.map((change, index) => (
          <li key={change.id}>
            <button
              type="button"
              aria-current={index === current ? 'true' : undefined}
              className={styles.change()}
              onClick={() => {
                onChoose(index)
              }}
            >
              <span className={styles.changeHead()}>
                <span data-change={change.change} className={styles.badge()}>
                  {changeName(change.change)}
                </span>{' '}
                <span className="whitespace-nowrap">{blockName(change.block)}</span>
                {/* A heading's own section is the heading: its excerpt already says it. */}
                {change.section === undefined ||
                change.section.title === change.excerpt ? undefined : (
                  <>
                    {' '}
                    <span className={styles.changeSection()}>
                      <span className="sr-only">in </span>
                      {change.section.title}
                    </span>
                  </>
                )}
              </span>
              {change.excerpt === '' ? undefined : (
                <>
                  {' '}
                  <span className={styles.changeText()}>{change.excerpt}</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function SectionList({
  sections,
  onChoose,
}: {
  readonly sections: Comparison['sections']
  readonly onChoose: (id: string) => void
}) {
  const styles = comparisonPageStyles()
  return (
    <nav aria-labelledby="comparison-sections">
      <h2 id="comparison-sections" className={styles.railHeading()}>
        Sections
      </h2>
      <ol className={styles.sectionList()}>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              data-changed={section.changes > 0}
              className={styles.section({
                depth: section.depth >= 3 ? 3 : section.depth === 2 ? 2 : 1,
              })}
              onClick={(event) => {
                event.preventDefault()
                onChoose(section.id)
              }}
            >
              <span>{section.title}</span>
              {section.changes === 0 ? undefined : (
                <span className={styles.sectionCount()}>
                  {section.changes === 1 ? '1 change' : `${section.changes} changes`}
                </span>
              )}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
