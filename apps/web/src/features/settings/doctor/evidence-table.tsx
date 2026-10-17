import { useState } from 'react'

import { Button, tv } from '@quill/ui'

import type { Evidence, Scheme } from '@quill/theme'

import { capitalise, pairName, roleName } from './doctor-copy.ts'
import { ColourChip, PairSpecimen, specimenKind } from './specimens.tsx'

/** What identifies one measured thing across two reports: a pair by its label, a colour by its role. */
export function evidenceKey(entry: Evidence): string {
  return entry.kind === 'contrast' ? entry.label : entry.role
}

/** True when the rule found this thing wanting in either scheme. */
export function evidenceFails(entry: Evidence): boolean {
  return entry.kind !== 'adjustment' && (!entry.light.holds || !entry.dark.holds)
}

export function evidenceLabel(entry: Evidence): string {
  return entry.kind === 'contrast'
    ? pairName(entry.foreground, entry.background)
    : capitalise(roleName(entry.role))
}

export const evidenceStyles = tv({
  slots: {
    table: 'w-auto max-w-full self-start border-collapse text-xs',
    head: 'pb-1.5 text-start text-2xs font-normal whitespace-nowrap text-muted',
    rowHead: 'py-1.5 pe-6 text-start align-middle font-normal text-foreground',
    cell: 'py-1.5 pe-6 align-middle last:pe-0',
    sample: 'flex flex-wrap items-center gap-x-2 gap-y-1',
    figure: 'text-2xs whitespace-nowrap text-muted tabular-nums',
    finding: 'text-2xs font-medium whitespace-nowrap text-warning',
    step: 'inline-flex items-center gap-1.5 text-2xs whitespace-nowrap text-muted',
    more: 'mt-1',
  },
  variants: {
    /** The finding under the specimen rather than beside it, where two samples share a line. */
    stacked: { true: { sample: 'flex-col items-start' } },
  },
})

function contrastFinding(entry: Extract<Evidence, { kind: 'contrast' }>, scheme: Scheme) {
  const { lc, holds } = entry[scheme]
  if (holds) return undefined
  const { lcAtMost } = entry.target
  return lcAtMost !== undefined && lc > lcAtMost ? 'Too strong' : 'Too faint'
}

export interface EvidenceSampleProps {
  readonly entry: Evidence
  readonly scheme: Scheme
  readonly stacked?: boolean
}

/** One measured thing in one scheme: its specimen, its number, and what is wrong with it. */
export function EvidenceSample({ entry, scheme, stacked = false }: EvidenceSampleProps) {
  const styles = evidenceStyles({ stacked })

  if (entry.kind === 'contrast') {
    const measured = entry[scheme]
    const finding = contrastFinding(entry, scheme)
    return (
      <span className={styles.sample()}>
        <PairSpecimen
          foreground={measured.foreground}
          background={measured.background}
          kind={specimenKind(entry.foreground)}
        />
        <span className={styles.figure()}>{measured.ratio.toFixed(1)}:1</span>
        {finding === undefined ? undefined : <span className={styles.finding()}>{finding}</span>}
      </span>
    )
  }

  if (entry.kind === 'swatch') {
    const sample = entry[scheme]
    return (
      <span className={styles.sample()}>
        <ColourChip colour={sample.colour} ground={sample.ground} ink={sample.ink} />
        {sample.holds ? undefined : <span className={styles.finding()}>Out of range</span>}
      </span>
    )
  }

  const adjusted = entry[scheme]
  if (adjusted === undefined) return <span className={styles.figure()}>Unchanged</span>
  return (
    <span className={styles.sample()}>
      <span className={styles.step()}>
        <ColourChip colour={adjusted.before} />
        As set
      </span>
      <span aria-hidden="true" className={styles.figure()}>
        →
      </span>
      <span className={styles.step()}>
        <ColourChip colour={adjusted.after} />
        As shipped
      </span>
    </span>
  )
}

export interface EvidenceTableProps {
  readonly evidence: readonly Evidence[]
  /** What the table is a record of, for its caption. */
  readonly caption: string
  /** How many rows show before "Show all". */
  readonly shown?: number
}

/**
 * Everything a rule measured, one row per thing and one column per scheme,
 * whatever failed first. A long list — a contrast rule measures forty pairs
 * — opens on its first few, and the rest are a click away rather than a
 * scroll in the way.
 */
export function EvidenceTable({ evidence, caption, shown = 4 }: EvidenceTableProps) {
  const [all, setAll] = useState(false)
  const styles = evidenceStyles()
  const ordered = [
    ...evidence.filter(evidenceFails),
    ...evidence.filter((entry) => !evidenceFails(entry)),
  ]
  const visible = all ? ordered : ordered.slice(0, shown)

  return (
    <div>
      <table className={styles.table()}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.head()}>
              Checked
            </th>
            <th scope="col" className={styles.head()}>
              Light
            </th>
            <th scope="col" className={styles.head()}>
              Dark
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((entry) => (
            <tr key={evidenceKey(entry)}>
              <th scope="row" className={styles.rowHead()}>
                {evidenceLabel(entry)}
              </th>
              <td className={styles.cell()}>
                <EvidenceSample entry={entry} scheme="light" />
              </td>
              <td className={styles.cell()}>
                <EvidenceSample entry={entry} scheme="dark" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ordered.length > shown ? (
        <Button
          size="sm"
          variant="ghost"
          className={styles.more()}
          aria-expanded={all}
          onClick={() => {
            setAll(!all)
          }}
        >
          {all ? 'Show fewer' : `Show all ${ordered.length}`}
        </Button>
      ) : undefined}
    </div>
  )
}
