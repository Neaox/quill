import { Block, Callout, LayoutGrid, ScrollGroup, Spinner, tv } from '@quill/ui'

import { ApiError, useRevisionDiff, type DiffRange } from '../../lib/api/index.ts'

/**
 * Added and removed are attributes on the line, never a class chosen in
 * JavaScript (`docs/architecture/styling.md`), so the styling and the meaning
 * come from the same place. Colour is not the only signal: the leading `+`
 * and `-` of the unified format are kept, and each line says which it is to a
 * screen reader.
 */
export const revisionDiffStyles = tv({
  slots: {
    root: 'flex flex-col gap-4',
    summary: 'meta-value flex flex-wrap items-center gap-x-4 gap-y-1',
    added: 'text-success',
    removed: 'text-danger',
    scroll: 'rounded-md border border-border bg-code-background',
    pre: 'w-max min-w-full p-4 font-mono text-xs leading-relaxed text-foreground',
    line: [
      'block whitespace-pre',
      'data-[change=added]:bg-success-subtle data-[change=removed]:bg-danger-subtle',
      'data-[change=file]:text-muted data-[change=hunk]:text-accent',
    ],
  },
})

type Change = 'added' | 'removed' | 'context' | 'hunk' | 'file'

interface DiffLine {
  readonly key: string
  readonly text: string
  readonly change: Change
}

/** What each kind of line is, in words, for the lines colour alone would carry. */
const ANNOUNCED: Partial<Record<Change, string>> = {
  added: 'added',
  removed: 'removed',
}

function classify(line: string): Change {
  if (line.startsWith('+++') || line.startsWith('---')) return 'file'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

/** The unified diff as lines, keyed by position because a diff repeats itself. */
export function diffLines(unified: string): readonly DiffLine[] {
  if (unified === '') return []
  return unified.split('\n').map((text, index) => ({
    key: `${index}`,
    text,
    change: classify(text),
  }))
}

export interface RevisionDiffViewProps {
  readonly documentId: string
  readonly range: DiffRange
  readonly fromLabel: string
  readonly toLabel: string
  readonly className?: string | undefined
}

/**
 * Two revisions, as the unified diff the content store produces.
 *
 * This is the whole reason the route is code-split: a reader who never
 * compares anything never downloads it.
 */
export function RevisionDiffView({
  documentId,
  range,
  fromLabel,
  toLabel,
  className,
}: RevisionDiffViewProps) {
  const diff = useRevisionDiff(documentId, range)
  const styles = revisionDiffStyles()

  if (diff.isPending) {
    return (
      <LayoutGrid className={className}>
        <Block>
          <Spinner className="size-5" />
        </Block>
      </LayoutGrid>
    )
  }

  if (diff.isError) {
    return (
      <LayoutGrid className={className}>
        <Block>
          <Callout tone="danger" title="Couldn't compare these revisions">
            {diff.error instanceof ApiError ? diff.error.message : 'Please try again.'}
          </Callout>
        </Block>
      </LayoutGrid>
    )
  }

  const lines = diffLines(diff.data.unified)

  return (
    <LayoutGrid className={className}>
      <Block width="wide" className={styles.root()}>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Comparing {fromLabel} with {toLabel}
        </h2>
        <p className={styles.summary()}>
          <span className={styles.added()}>+{diff.data.added}</span>
          <span className={styles.removed()}>&minus;{diff.data.removed}</span>
          <span>
            {fromLabel} &rarr; {toLabel}
          </span>
        </p>

        {lines.length === 0 ? (
          <Callout tone="info" title="No difference">
            These two revisions have the same content.
          </Callout>
        ) : (
          <ScrollGroup label="Unified diff" className={styles.scroll()}>
            <pre className={styles.pre()}>
              <code>
                {lines.map((line) => (
                  <span key={line.key} data-change={line.change} className={styles.line()}>
                    {ANNOUNCED[line.change] === undefined ? undefined : (
                      <span className="sr-only">{ANNOUNCED[line.change]}: </span>
                    )}
                    {line.text}
                    {'\n'}
                  </span>
                ))}
              </code>
            </pre>
          </ScrollGroup>
        )}
      </Block>
    </LayoutGrid>
  )
}
