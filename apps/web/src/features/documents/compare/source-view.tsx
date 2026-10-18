import { useState, type ReactNode } from 'react'

import { Block, Callout, LayoutGrid, Spinner, tv } from '@quill/ui'

import { ApiError, type SourceLine } from '../../../lib/api/index.ts'
import type { ComparisonLayout } from '../../../lib/routing/document-reference.ts'
import { foldSource, sideBySide, type SourcePart } from './source-hunks.ts'

/**
 * The Markdown of both versions, line by line, in the theme's code colours.
 *
 * No hunk headers and no file names: a line number on each side, a sign, and
 * the words that changed inside a changed line picked out. Unchanged
 * stretches fold to a button, so a 4,000-line document draws its changes and
 * a few lines around each. Side by side is offered where there is room for
 * two columns; a phone always gets the unified view.
 */
export const sourceViewStyles = tv({
  slots: {
    frame: [
      'overflow-x-auto rounded-lg border border-border bg-code-background text-foreground',
      'font-mono text-xs leading-relaxed',
    ],
    table: 'w-full border-collapse',
    number: [
      'w-0 border-e border-border px-2 text-end align-top whitespace-nowrap text-muted',
      'tabular-nums select-none',
    ],
    sign: 'w-0 ps-2 pe-1 align-top text-muted select-none',
    text: 'px-2 align-top break-words whitespace-pre-wrap',
    row: [
      'scroll-mt-24 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
      'data-[change=added]:bg-success-subtle data-[change=removed]:bg-danger-subtle',
    ],
    cell: [
      'data-[change=added]:bg-success-subtle data-[change=removed]:bg-danger-subtle',
      'data-[change=empty]:bg-surface/50',
    ],
    added: 'rounded-xs bg-success/25 text-inherit no-underline',
    removed: 'rounded-xs bg-danger/25 text-inherit line-through decoration-danger',
    gap: 'border-y border-border bg-surface/60',
    gapButton: [
      'w-full px-3 py-1.5 text-start font-sans text-xs text-muted hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
})

const SIGN: Readonly<Record<SourceLine['change'], string>> = {
  equal: ' ',
  added: '+',
  removed: '−',
}
const SPOKEN: Readonly<Record<SourceLine['change'], string | undefined>> = {
  equal: undefined,
  added: 'Added line',
  removed: 'Removed line',
}

function Segments({ line }: { readonly line: SourceLine }) {
  const styles = sourceViewStyles()
  // A line that is wholly new or wholly gone is marked by its row; only the
  // words that changed inside an edited line are picked out.
  const wholeLine = line.segments.every((segment) => segment.change !== 'equal')
  return line.segments.map((segment, index) => {
    const key = `${index}`
    if (segment.change === 'equal' || line.change === 'equal' || wholeLine) return segment.text
    return segment.change === 'added' ? (
      <ins key={key} className={styles.added()}>
        {segment.text}
      </ins>
    ) : (
      <del key={key} className={styles.removed()}>
        {segment.text}
      </del>
    )
  })
}

function Sign({ line }: { readonly line: SourceLine }) {
  const spoken = SPOKEN[line.change]
  return (
    <>
      <span aria-hidden="true">{SIGN[line.change]}</span>
      {spoken === undefined ? undefined : <span className="sr-only">{spoken}</span>}
    </>
  )
}

export interface SourceViewProps {
  readonly lines: readonly SourceLine[]
  readonly layout: ComparisonLayout
  readonly caption: string
}

/** Rows for one part: a hunk drawn, or a gap folded behind its button until opened. */
function useOpenGaps() {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  return {
    isOpen: (index: number) => open.has(index),
    openGap: (index: number) => {
      setOpen((current) => new Set([...current, index]))
    },
  }
}

function GapRow({
  part,
  columns,
  onOpen,
}: {
  readonly part: SourcePart
  readonly columns: number
  readonly onOpen: () => void
}) {
  const styles = sourceViewStyles()
  return (
    <tr className={styles.gap()}>
      <td colSpan={columns}>
        <button type="button" className={styles.gapButton()} onClick={onOpen}>
          {`Show ${part.lines.length} unchanged lines`}
        </button>
      </td>
    </tr>
  )
}

function firstChangedLine(part: SourcePart): SourceLine | undefined {
  return part.kind === 'hunk' ? part.lines.find((line) => line.change !== 'equal') : undefined
}

function UnifiedRows({ part }: { readonly part: SourcePart }) {
  const styles = sourceViewStyles()
  const first = firstChangedLine(part)
  return part.lines.map((line) => (
    <tr
      key={`${line.before ?? ''}:${line.after ?? ''}:${line.change}`}
      data-change={line.change}
      {...(line === first ? { 'data-hunk': part.index, tabIndex: -1 } : {})}
      className={styles.row()}
    >
      <td className={styles.number()}>{line.before ?? ''}</td>
      <td className={styles.number()}>{line.after ?? ''}</td>
      <td className={styles.sign()}>
        <Sign line={line} />
      </td>
      <td className={styles.text()}>
        <Segments line={line} />
      </td>
    </tr>
  ))
}

function SplitRows({ part }: { readonly part: SourcePart }) {
  const styles = sourceViewStyles()
  const first = firstChangedLine(part)
  const half = (line: SourceLine | undefined, side: 'before' | 'after'): ReactNode => {
    const change = line === undefined ? 'empty' : line.change
    return (
      <>
        <td data-change={change} className={styles.number({ className: styles.cell() })}>
          {line?.[side] ?? ''}
        </td>
        <td data-change={change} className={styles.text({ className: styles.cell() })}>
          {line === undefined ? undefined : (
            <>
              {line.change === 'equal' ? undefined : <Sign line={line} />}
              {line.change === 'equal' ? undefined : ' '}
              <Segments line={line} />
            </>
          )}
        </td>
      </>
    )
  }
  return sideBySide(part.lines).map((row) => {
    const isFirst = row.before === first || row.after === first
    return (
      <tr
        key={`${row.before?.before ?? ''}:${row.after?.after ?? ''}`}
        {...(isFirst && first !== undefined ? { 'data-hunk': part.index, tabIndex: -1 } : {})}
        className={styles.row()}
      >
        {half(
          row.before === undefined || row.before.change === 'added' ? undefined : row.before,
          'before',
        )}
        {half(
          row.after === undefined || row.after.change === 'removed' ? undefined : row.after,
          'after',
        )}
      </tr>
    )
  })
}

export function SourceView({ lines, layout, caption }: SourceViewProps) {
  const styles = sourceViewStyles()
  const parts = foldSource(lines)
  const gaps = useOpenGaps()

  const body = (Rows: typeof UnifiedRows, columns: number) =>
    parts.map((part) =>
      part.kind === 'gap' && !gaps.isOpen(part.index) ? (
        <GapRow
          key={part.index}
          part={part}
          columns={columns}
          onOpen={() => {
            gaps.openGap(part.index)
          }}
        />
      ) : (
        <Rows key={part.index} part={part} />
      ),
    )

  const unified = (
    <table className={styles.table()}>
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Line before</th>
          <th scope="col">Line after</th>
          <th scope="col">Change</th>
          <th scope="col">Text</th>
        </tr>
      </thead>
      <tbody>{body(UnifiedRows, 4)}</tbody>
    </table>
  )

  if (layout === 'unified') return <div className={styles.frame()}>{unified}</div>

  return (
    <>
      <div className={styles.frame({ className: 'md:hidden' })}>{unified}</div>
      <div className={styles.frame({ className: 'max-md:hidden' })}>
        <table className={styles.table({ className: 'table-fixed' })}>
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col className="w-12" />
            <col />
            <col className="w-12" />
            <col />
          </colgroup>
          <thead className="sr-only">
            <tr>
              <th scope="col">Line before</th>
              <th scope="col">Before</th>
              <th scope="col">Line after</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>{body(SplitRows, 4)}</tbody>
        </table>
      </div>
    </>
  )
}

/** The source view with its request: asked for only when it is opened. */
export function SourceViewPanel({
  query,
  layout,
  caption,
}: {
  readonly query: {
    readonly isPending: boolean
    readonly isError: boolean
    readonly error: unknown
    readonly data?: { readonly lines: readonly SourceLine[] } | undefined
  }
  readonly layout: ComparisonLayout
  readonly caption: string
}) {
  return (
    <LayoutGrid className="pb-24">
      <Block width="wide">
        {query.data !== undefined ? (
          <SourceView lines={query.data.lines} layout={layout} caption={caption} />
        ) : query.isError ? (
          <Callout tone="danger" title="Couldn't load the source">
            {query.error instanceof ApiError ? query.error.message : 'Please try again.'}
          </Callout>
        ) : (
          <Spinner className="size-5" />
        )}
      </Block>
    </LayoutGrid>
  )
}
