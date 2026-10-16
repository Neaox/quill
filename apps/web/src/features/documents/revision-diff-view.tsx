import { useEffect, useRef } from 'react'

import { Block, Button, Callout, LayoutGrid, Spinner, tv } from '@quill/ui'

import { ApiError, useComparison, type ComparisonRange } from '../../lib/api/index.ts'
import { enhanceComparison, type ComparisonSurface } from './compare/comparison-surface.ts'
import { DocumentBody } from './document-body.tsx'
import { describeChanges } from './publish-changes.ts'

export const revisionDiffStyles = tv({
  slots: {
    // The page this sits on has no title of its own, so the header carries the top; the body
    // brings the bottom, as when a document is read.
    frame: 'pt-8',
    body: 'pt-6 pb-24',
    root: 'flex flex-col gap-4',
    summary: 'meta-value flex flex-wrap items-center gap-x-4 gap-y-1',
    changes: 'flex flex-col gap-1.5 text-sm',
    changesLabel: 'text-xs font-medium text-muted',
    list: 'flex flex-wrap gap-1.5',
    kind: 'font-medium text-foreground',
    where: 'text-muted',
    properties: 'flex flex-col gap-1 text-sm text-foreground-soft',
  },
})

export interface RevisionDiffViewProps {
  readonly documentId: string
  readonly range: ComparisonRange
  readonly fromLabel: string
  readonly toLabel: string
}

const KIND: Readonly<Record<'added' | 'changed' | 'removed' | 'moved', string>> = {
  added: 'Added',
  changed: 'Changed',
  removed: 'Removed',
  moved: 'Moved',
}

/**
 * Two revisions as one page: the document as it reads, with what changed marked where it is
 * (ADR-031's comparison, drawn by the comparison stylesheet), and a way to go from change to
 * change.
 *
 * A long unchanged stretch is folded away behind a button that says what it holds, so a small edit
 * to a long page is not a scroll through the page. The list of changes is the comparison's own:
 * choosing one takes the reader to it and marks it. This is why the route is code-split: a reader
 * who never compares anything never downloads it.
 */
export function RevisionDiffView({ documentId, range, fromLabel, toLabel }: RevisionDiffViewProps) {
  const comparison = useComparison(documentId, range)
  const host = useRef<HTMLDivElement | null>(null)
  const surface = useRef<ComparisonSurface | undefined>(undefined)
  const styles = revisionDiffStyles()

  /* Synchronises with the DOM the comparison's body was mounted into, which React did not draw:
     the folds and marks put on it are taken off when the page goes away. */
  useEffect(
    () => () => {
      surface.current?.dispose()
    },
    [],
  )

  // Each time the body is drawn (it is drawn again for a different comparison) the page is
  // enhanced afresh, because the nodes the last one folded are gone.
  function enhance() {
    surface.current?.dispose()
    const article = host.current?.querySelector('article')
    surface.current = article == null ? undefined : enhanceComparison(article)
  }

  if (comparison.isPending) {
    return (
      <LayoutGrid className={styles.frame()}>
        <Block>
          <Spinner className="size-5" />
        </Block>
      </LayoutGrid>
    )
  }

  if (comparison.isError) {
    return (
      <LayoutGrid className={styles.frame()}>
        <Block>
          <Callout tone="danger" title="Couldn't compare these revisions">
            {comparison.error instanceof ApiError ? comparison.error.message : 'Please try again.'}
          </Callout>
        </Block>
      </LayoutGrid>
    )
  }

  const { data } = comparison
  const described = describeChanges(data)

  return (
    <>
      <LayoutGrid className={styles.frame()}>
        <Block width="wide" className={styles.root()}>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Comparing {fromLabel} with {toLabel}
          </h2>

          {described.empty ? (
            <Callout tone="info" title="No difference">
              These two revisions have the same content.
            </Callout>
          ) : (
            <>
              <p className={styles.summary()}>
                <span>{described.headline}</span>
                {described.words === '' ? undefined : <span>{described.words}</span>}
              </p>

              {data.changes.length === 0 ? undefined : (
                <nav aria-label="Changes" className={styles.changes()}>
                  <p className={styles.changesLabel()}>Go to a change</p>
                  <ul className={styles.list()}>
                    {data.changes.map((change) => (
                      <li key={change.id}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            surface.current?.goTo(change.id)
                          }}
                        >
                          <span className={styles.kind()}>{KIND[change.change]}</span>{' '}
                          <span className={styles.where()}>
                            in {change.section?.title ?? 'the start'}
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}

              {data.properties.length === 0 ? undefined : (
                <ul aria-label="Changed properties" className={styles.properties()}>
                  {data.properties.map((property) => (
                    <li key={property.name}>
                      <span className={styles.kind()}>{property.name}</span>:{' '}
                      {property.before ?? 'none'} → {property.after ?? 'none'}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Block>
      </LayoutGrid>

      {/* The body is laid out as the reading grid itself, so it sits beside the header's grid
          rather than inside it, as it does when a document is read (`document-reader.tsx`). */}
      <div ref={host} className="contents">
        <DocumentBody
          html={data.html}
          label="Comparison"
          className={styles.body()}
          onMounted={enhance}
        />
      </div>
    </>
  )
}
