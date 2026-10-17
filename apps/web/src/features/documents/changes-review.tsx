import { useState, useTransition } from 'react'
import type { KeyboardEvent } from 'react'

import '@quill/design-css/comparison.css'

import {
  Badge,
  Button,
  ChevronDownIcon,
  ChevronUpIcon,
  Dialog,
  RelativeTime,
  RestoreIcon,
  Spinner,
  tv,
  type BadgeTone,
} from '@quill/ui'

import { DRAFT_SIDE, useComparison } from '../../lib/api/content.ts'
import type { ComparisonChange } from '../../lib/api/types.ts'
import { counted } from '../../lib/text/plural.ts'
import { DocumentBody } from './document-body.tsx'
import { describeChanges } from './publish-changes.ts'

export const changesReviewStyles = tv({
  slots: {
    panel: 'w-[min(76rem,calc(100vw-2rem))]',
    bar: 'flex flex-wrap items-center gap-2 border-b border-border pb-3',
    position: 'me-auto font-mono text-2xs tracking-caps text-muted uppercase',
    layout: 'grid min-h-[min(20rem,60dvh)] gap-4 md:grid-cols-[19rem_minmax(0,1fr)]',
    rail: 'flex max-h-[58dvh] min-h-0 flex-col gap-2 md:border-e md:border-border md:pe-3',
    selection: 'flex items-center justify-between gap-2 text-2xs text-muted',
    list: 'flex min-h-0 flex-col gap-1 overflow-y-auto',
    row: [
      'flex items-start gap-2 rounded-md border border-transparent p-2',
      'aria-[current=true]:border-accent/40 aria-[current=true]:bg-accent-subtle',
    ],
    pick: 'mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]',
    open: [
      'flex min-w-0 grow flex-col items-start gap-1 rounded-sm text-start',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    excerpt: 'line-clamp-2 w-full text-xs text-foreground',
    where: 'w-full truncate text-2xs text-muted',
    detail: 'flex min-w-0 flex-col gap-3',
    heading: 'flex flex-wrap items-center gap-x-3 gap-y-1',
    title: 'text-sm font-medium text-foreground',
    meta: 'text-2xs text-muted',
    words: 'font-mono text-2xs text-muted',
    panes: 'grid gap-3 lg:grid-cols-2',
    pane: 'flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised',
    paneTitle: [
      'border-b border-border bg-surface px-3 py-1.5',
      'font-mono text-2xs tracking-caps text-muted uppercase',
    ],
    paneBody: 'min-w-0 overflow-x-auto p-3',
    nothing: 'p-3 text-xs text-muted italic',
    note: 'me-auto text-xs text-muted',
  },
})

const TONES: Readonly<Record<ComparisonChange['change'], BadgeTone>> = {
  added: 'success',
  removed: 'danger',
  changed: 'warning',
  moved: 'accent',
}

const KINDS: Readonly<Record<ComparisonChange['change'], string>> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  moved: 'Moved',
}

const WORD = { one: 'word', other: 'words' }

export interface RevertAbility {
  /** Whether putting changes back is possible now (the lock is held, everything is saved). */
  readonly allowed: boolean
  /** Why not, when it is not. */
  readonly reason?: string
  /** Puts these changes back in the draft; resolves when it is done. */
  readonly run: (changes: readonly string[]) => Promise<void>
}

export interface ChangesReviewProps {
  readonly documentId: string
  /** The revision on the page now, which the draft is measured against. */
  readonly published: string | null
  /** The version of the draft last saved. */
  readonly saved: number
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The change to open on, as the comparison names it. */
  readonly initial?: string | undefined
  readonly revert: RevertAbility
}

function Pane({
  side,
  change,
}: {
  readonly side: 'before' | 'after'
  readonly change: ComparisonChange
}) {
  const styles = changesReviewStyles()
  const title = side === 'before' ? 'Published' : 'Your draft'
  const absent =
    (side === 'before' && change.change === 'added') ||
    (side === 'after' && change.change === 'removed')
  return (
    <section aria-label={title} className={styles.pane()}>
      <h3 className={styles.paneTitle()}>{title}</h3>
      {absent || change.html === undefined ? (
        <p className={styles.nothing()}>
          {side === 'before' ? 'Not in the published page.' : 'Taken out of your draft.'}
        </p>
      ) : (
        <div data-pane={side} className={styles.paneBody()}>
          <DocumentBody html={change.html} label={`${title}: ${change.excerpt}`} />
        </div>
      )}
    </section>
  )
}

function withToggled(picked: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return picked.has(id)
    ? new Set([...picked].filter((each) => each !== id))
    : new Set([...picked, id])
}

/** Why a change cannot be put back, in the words of what is true of it. */
function whyNot(change: ComparisonChange): string {
  return change.change === 'moved'
    ? 'A move cannot be put back from here: the block is the same, and only its place differs.'
    : 'This block is written differently in your draft than it will be published (a template part, say), so putting it back here could change the wrong thing. Edit it in the page instead.'
}

/**
 * What changed since the page was published, one change at a time: the published words
 * beside yours, with the words that differ marked on each side and the characters that
 * differ within a word marked again. Any change, or several, can be put back in the draft
 * from here.
 *
 * The list is the comparison's own, and the panes are the same rendered change drawn
 * twice with the other side's words hidden (`[data-pane]`, in the comparison stylesheet),
 * so what is shown is what a reader would meet. Putting changes back is the caller's
 * (`revert`): it is an edit of the draft, so it belongs to the editor that holds it.
 * The list is a keyboard's too: the arrow keys move between changes.
 */
export function ChangesReview({
  documentId,
  published,
  saved,
  open,
  onOpenChange,
  initial,
  revert,
}: ChangesReviewProps) {
  const styles = changesReviewStyles()
  const comparison = useComparison(
    documentId,
    { from: published, to: DRAFT_SIDE },
    { version: saved, patches: true },
  )
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [pending, startReverting] = useTransition()

  const changes = comparison.data?.changes ?? []
  const index = Math.max(
    0,
    changes.findIndex(({ id }) => id === (chosen ?? initial)),
  )
  const current = changes[index]
  const described = comparison.data === undefined ? undefined : describeChanges(comparison.data)
  const revertible = changes.filter(({ revertible: can }) => can === true)

  function show(target: number) {
    const next = changes[Math.min(Math.max(target, 0), changes.length - 1)]
    if (next === undefined) return
    setChosen(next.id)
    // The row that is open is the one the keyboard is on.
    queueMicrotask(() => {
      document.getElementById(`review-${next.id}`)?.focus()
    })
  }

  function onListKey(event: KeyboardEvent) {
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: changes.length - 1,
    }
    const target = moves[event.key]
    if (target === undefined) return
    event.preventDefault()
    show(target)
  }

  // The ids are the comparison's, numbered afresh for each version of the draft, so
  // once changes are put back none of the old ones still names what it did.
  function putBack(ids: readonly string[]) {
    startReverting(async () => {
      await revert.run(ids)
      setPicked(new Set())
      setChosen(undefined)
    })
  }

  const canRevert = revert.allowed && !pending
  const description =
    described === undefined || described.empty
      ? undefined
      : [described.headline, described.words].filter((part) => part !== '').join(' · ')

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Review changes"
      description={description}
      className={styles.panel()}
      footer={
        <>
          {revert.allowed || revert.reason === undefined ? undefined : (
            <p className={styles.note()}>{revert.reason}</p>
          )}
          <Button
            variant="secondary"
            iconStart={<RestoreIcon />}
            disabled={!canRevert || picked.size === 0}
            loading={pending}
            onClick={() => {
              putBack([...picked])
            }}
          >
            {picked.size === 0 ? 'Put back selected' : `Put back ${String(picked.size)} selected`}
          </Button>
          <Button
            iconStart={<RestoreIcon />}
            disabled={!canRevert || current?.revertible !== true}
            loading={pending}
            onClick={() => {
              if (current !== undefined) putBack([current.id])
            }}
          >
            Put this back
          </Button>
        </>
      }
    >
      {comparison.data === undefined ? (
        <Spinner className="size-5" />
      ) : changes.length === 0 ? (
        <p className={styles.nothing()}>No changes since this was last published.</p>
      ) : (
        <>
          <div className={styles.bar()}>
            <p className={styles.position()}>
              Change {index + 1} of {changes.length}
            </p>
            <Button
              variant="secondary"
              size="sm"
              iconStart={<ChevronUpIcon />}
              disabled={index === 0}
              onClick={() => {
                show(index - 1)
              }}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconEnd={<ChevronDownIcon />}
              disabled={index === changes.length - 1}
              onClick={() => {
                show(index + 1)
              }}
            >
              Next
            </Button>
          </div>
          <div className={styles.layout()}>
            <div className={styles.rail()}>
              <div className={styles.selection()}>
                <span>
                  {picked.size === 0
                    ? `${counted(revertible.length, { one: 'change', other: 'changes' })} can be put back`
                    : `${String(picked.size)} selected`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revertible.length === 0 && picked.size === 0}
                  onClick={() => {
                    setPicked(
                      picked.size === 0 ? new Set(revertible.map(({ id }) => id)) : new Set(),
                    )
                  }}
                >
                  {picked.size === 0 ? 'Select all' : 'Clear'}
                </Button>
              </div>
              <ul aria-label="Changes" className={styles.list()}>
                {changes.map((change) => (
                  <li
                    key={change.id}
                    className={styles.row()}
                    aria-current={change.id === current?.id ? 'true' : undefined}
                  >
                    <input
                      type="checkbox"
                      className={styles.pick()}
                      aria-label={`Select: ${change.excerpt}`}
                      disabled={change.revertible !== true}
                      checked={picked.has(change.id)}
                      onChange={() => {
                        setPicked((already) => withToggled(already, change.id))
                      }}
                    />
                    <button
                      type="button"
                      id={`review-${change.id}`}
                      className={styles.open()}
                      onKeyDown={onListKey}
                      onClick={() => {
                        setChosen(change.id)
                      }}
                    >
                      <Badge tone={TONES[change.change]}>{KINDS[change.change]}</Badge>
                      <span className={styles.excerpt()}>{change.excerpt}</span>
                      <span className={styles.where()}>{change.section?.title ?? 'The start'}</span>
                      {change.author === undefined ? undefined : (
                        <span className={styles.where()}>
                          {change.author.name ?? 'Someone'},{' '}
                          <RelativeTime value={change.author.at} />
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {current === undefined ? undefined : (
              <div className={styles.detail()}>
                <div className={styles.heading()}>
                  <Badge tone={TONES[current.change]}>{KINDS[current.change]}</Badge>
                  <p className={styles.title()}>{current.section?.title ?? 'The start'}</p>
                  {current.wordsAdded === 0 && current.wordsRemoved === 0 ? undefined : (
                    <p className={styles.words()}>
                      {[
                        current.wordsAdded === 0 ? '' : `+${counted(current.wordsAdded, WORD)}`,
                        current.wordsRemoved === 0 ? '' : `−${counted(current.wordsRemoved, WORD)}`,
                      ]
                        .filter((part) => part !== '')
                        .join(', ')}
                    </p>
                  )}
                </div>
                <div className={styles.panes()}>
                  <Pane side="before" change={current} />
                  <Pane side="after" change={current} />
                </div>
                {current.revertible === true ? undefined : (
                  <p className={styles.note()}>{whyNot(current)}</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}
