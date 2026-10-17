import { useId, useState, type ReactNode } from 'react'

import { ChevronRightIcon, tv } from '@quill/ui'

import type { Evidence, RuleStatus } from '@quill/theme'

import { ruleCopy } from './doctor-copy.ts'
import { EvidenceTable } from './evidence-table.tsx'

/**
 * What a row needs of a doctor result: the fields the report has always
 * carried, and the evidence `@quill/theme` now attaches. Evidence is optional
 * because a report from the server leaves it out.
 */
export interface DoctorRuleView {
  readonly id: string
  readonly section: number
  readonly title: string
  readonly status: RuleStatus
  readonly detail: string
  readonly enforced: boolean
  readonly evidence?: readonly Evidence[] | undefined
}

export const doctorRuleStyles = tv({
  slots: {
    row: 'flex flex-col',
    trigger: [
      'group focus-ring-inset flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-start',
      'transition-colors hover:bg-surface',
    ],
    chevron: [
      'mt-0.5 size-3.5 shrink-0 text-muted transition-transform',
      'group-aria-expanded:rotate-90 motion-reduce:transition-none',
    ],
    title: 'min-w-0 text-xs font-medium text-foreground',
    enforced: 'font-normal text-muted',
    panel: 'flex flex-col gap-3 px-3 pt-0.5 pb-3 sm:ps-8.5',
    about: 'text-xs leading-relaxed text-muted',
    details: 'text-2xs leading-relaxed text-muted',
    detailsSummary: 'focus-ring w-fit cursor-pointer rounded-sm',
    detailsBody: 'mt-1 flex flex-col gap-1 break-words',
  },
})

export interface DoctorRuleProps {
  readonly result: DoctorRuleView
  readonly defaultOpen?: boolean
  /** Shown under the evidence: the suggested fixes, for a warning. */
  readonly children?: ReactNode
}

/**
 * One finding of the doctor, as a disclosure: a plain heading that opens onto
 * what was measured, drawn in context in both schemes, anything the user can
 * do about it, and — quieter, behind "Details" — the measurement in the
 * rule's own terms.
 *
 * The panel is rendered only while open, because what it shows is not free:
 * the specimens paint dozens of colours, and a warning's fixes are searched
 * for by generating the theme again.
 */
export function DoctorRule({ result, defaultOpen = false, children }: DoctorRuleProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const styles = doctorRuleStyles()
  const copy = ruleCopy(result.id, result.title)
  const evidence = result.evidence ?? []

  return (
    <li className={styles.row()}>
      <button
        type="button"
        className={styles.trigger()}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <ChevronRightIcon className={styles.chevron()} />
        <span className={styles.title()}>
          {copy.title}
          {result.enforced ? <span className={styles.enforced()}> · Required for AA</span> : ''}
        </span>
      </button>

      {open ? (
        <div id={panelId} className={styles.panel()}>
          {copy.about === '' ? undefined : <p className={styles.about()}>{copy.about}</p>}
          {evidence.length === 0 ? undefined : (
            <EvidenceTable evidence={evidence} caption={`What “${copy.title}” measured`} />
          )}
          {children}
          <details className={styles.details()}>
            <summary className={styles.detailsSummary()}>Details</summary>
            <div className={styles.detailsBody()}>
              <p>{result.detail}</p>
              <p>
                {result.title}. Colour rules, section {result.section}.
              </p>
            </div>
          </details>
        </div>
      ) : undefined}
    </li>
  )
}
