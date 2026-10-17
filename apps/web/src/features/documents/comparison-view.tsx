import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import {
  Block,
  Button,
  Callout,
  LayoutGrid,
  RevisionPicker,
  Spinner,
  tv,
  type RevisionChoice,
} from '@quill/ui'
import '@quill/design-css/comparison.css'

import { ApiError, useComparison, type ComparisonRange } from '../../lib/api/index.ts'
import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { counted } from '../../lib/text/plural.ts'
import { enhanceComparison, type ComparisonSurface } from './compare/comparison-surface.ts'
import { DocumentBody } from './document-body.tsx'

export const comparisonViewStyles = tv({
  slots: {
    header: 'flex flex-col gap-4',
    pickers: 'flex flex-wrap items-center gap-2',
    summary: 'meta-value flex flex-wrap items-center gap-x-4 gap-y-1',
    added: 'text-success',
    removed: 'text-danger',
    body: 'pt-6 pb-24',
  },
})

const WORD = { one: 'word', other: 'words' }
const CHANGE = { one: 'change', other: 'changes' }

export interface ComparisonViewProps {
  readonly documentId: string
  readonly workspaceSlug: string
  readonly range: ComparisonRange
  readonly fromLabel: string
  readonly toLabel: string
  /** Every revision there is, which the two pickers choose between. */
  readonly revisions: readonly LabelledRevision[]
  readonly className?: string | undefined
}

function choicesFrom(
  revisions: readonly LabelledRevision[],
  otherEnd: string | null,
): readonly RevisionChoice[] {
  return revisions.map((revision, index) => ({
    id: revision.revision,
    label: revision.label,
    at: revision.date,
    author: revision.authorName,
    note: revision.changeNote,
    tag: index === 0 ? 'Latest' : undefined,
    disabled: revision.revision === otherEnd,
  }))
}

/**
 * Two revisions as one page: the document with what was added, removed, changed
 * and moved marked where it is (`GET /documents/:id/compare`), the long stretches
 * that did not change folded away, and a way to go from one change to the next.
 *
 * The two ends are URL state (ADR-013), so choosing one navigates and the
 * comparison can be linked to. This is the whole reason the route is code-split:
 * a reader who never compares anything never downloads it.
 */
export function ComparisonView({
  documentId,
  workspaceSlug,
  range,
  fromLabel,
  toLabel,
  revisions,
  className,
}: ComparisonViewProps) {
  const comparison = useComparison(documentId, range)
  const navigate = useNavigate()
  const styles = comparisonViewStyles()
  const host = useRef<HTMLDivElement | null>(null)
  const surface = useRef<ComparisonSurface | undefined>(undefined)
  const [position, setPosition] = useState(-1)

  /* Synchronises the drawn comparison with the folds and the focus ring the
     surface keeps on it, which React does not render; undone on the way out. */
  useEffect(
    () => () => {
      surface.current?.dispose()
    },
    [],
  )

  function enhance() {
    const article = host.current?.querySelector('article')
    if (article == null) return
    surface.current?.dispose()
    surface.current = enhanceComparison(article)
    setPosition(-1)
  }

  function choose(end: 'from' | 'to', revision: string) {
    void navigate({
      to: '/w/$workspaceSlug/d/$documentId',
      params: { workspaceSlug, documentId },
      search: {
        ...(range.from === null ? {} : { from: range.from }),
        to: range.to,
        [end]: revision,
      },
    })
  }

  if (comparison.isPending) {
    return (
      <LayoutGrid className={className}>
        <Block>
          <Spinner className="size-5" />
        </Block>
      </LayoutGrid>
    )
  }

  if (comparison.isError) {
    return (
      <LayoutGrid className={className}>
        <Block>
          <Callout tone="danger" title="Couldn't compare these revisions">
            {comparison.error instanceof ApiError ? comparison.error.message : 'Please try again.'}
          </Callout>
        </Block>
      </LayoutGrid>
    )
  }

  const { summary, changes, html } = comparison.data
  const total = summary.added + summary.removed + summary.changed + summary.moved

  function next() {
    const following = (position + 1) % changes.length
    const change = changes[following]
    if (change === undefined) return
    setPosition(following)
    surface.current?.goTo(change.id)
  }

  return (
    <LayoutGrid className={className}>
      <Block width="wide" className={styles.header()}>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Comparing {fromLabel} with {toLabel}
        </h2>
        <div className={styles.pickers()}>
          <RevisionPicker
            label="From"
            value={range.from ?? ''}
            choices={choicesFrom(revisions, range.to)}
            onValueChange={(revision) => {
              choose('from', revision)
            }}
          />
          <RevisionPicker
            label="To"
            value={range.to}
            choices={choicesFrom(revisions, range.from)}
            onValueChange={(revision) => {
              choose('to', revision)
            }}
          />
          <Button variant="secondary" size="sm" disabled={changes.length === 0} onClick={next}>
            Next change
          </Button>
        </div>
        <p className={styles.summary()}>
          <span className={styles.added()}>+{counted(summary.wordsAdded, WORD)}</span>
          <span className={styles.removed()}>&minus;{counted(summary.wordsRemoved, WORD)}</span>
          <span>{counted(total, CHANGE)}</span>
        </p>
      </Block>

      {total === 0 ? (
        <Block width="wide">
          <Callout tone="info" title="No difference">
            These two revisions have the same content.
          </Callout>
        </Block>
      ) : (
        <div ref={host} className={styles.body()}>
          <DocumentBody
            html={html}
            label={`${fromLabel} compared with ${toLabel}`}
            onMounted={enhance}
          />
        </div>
      )}
    </LayoutGrid>
  )
}
