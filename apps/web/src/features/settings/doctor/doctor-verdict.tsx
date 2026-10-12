import { Fragment } from 'react'

import { Badge, CheckIcon, badgeStyles, tv, type BadgeTone } from '@quill/ui'

import { severityCounts, type Severity } from '@quill/theme'

import { allClear, describeVerdict, STATUS_COPY, type DoctorSummary } from './doctor-copy.ts'

/** Where each group of the report starts, so a count can point at it. */
export function doctorGroupId(severity: Severity): string {
  return `theme-doctor-${severity}`
}

const VERDICT_TONE: Readonly<Record<Severity, BadgeTone>> = {
  warn: 'warning',
  adjusted: 'accent',
  accepted: 'neutral',
  pass: 'neutral',
}

export const doctorVerdictStyles = tv({
  slots: {
    row: 'inline-flex flex-wrap items-center gap-1.5',
    clear: 'inline-flex items-center gap-1 text-xs text-muted',
    clearIcon: 'size-3.5 text-success',
    compact: 'text-2xs text-muted',
    action: 'focus-ring cursor-pointer transition-colors hover:border-current',
  },
})

export interface DoctorVerdictProps {
  readonly summary: DoctorSummary
  /** `compact` is plain small text for a bar; `badges` is the default. */
  readonly variant?: 'badges' | 'compact'
  /** Each count links to its group in the report on the same page. */
  readonly linked?: boolean
  /** Makes "to check" a button, for a surface that has to be left to reach the report. */
  readonly onReview?: (() => void) | undefined
  readonly id?: string | undefined
}

/**
 * The doctor's verdict at a glance, most severe first: "3 to check",
 * "4 adjusted", "16 passing", leaving out any group with nothing in it, and
 * a single quiet "All 23 checks pass" when nothing needs a look.
 *
 * One component for every place the verdict appears — the report's own
 * header, the phone's preview bar and its sheet — so the words, the order
 * and the tones are stated once. It renders inline content only, because two
 * of those places put it inside a button or a dialog's description.
 */
export function DoctorVerdict({
  summary,
  variant = 'badges',
  linked = false,
  onReview,
  id,
}: DoctorVerdictProps) {
  const styles = doctorVerdictStyles()
  const clear = allClear(summary)

  if (variant === 'compact') {
    return (
      <span id={id} className={styles.compact()}>
        {describeVerdict(summary, ' · ')}
      </span>
    )
  }

  if (clear !== undefined) {
    return (
      <span id={id} className={styles.clear()}>
        <CheckIcon className={styles.clearIcon()} />
        {clear}
      </span>
    )
  }

  return (
    <span id={id} className={styles.row()}>
      {severityCounts(summary).map(({ severity, count }, index) => {
        const words = `${count} ${STATUS_COPY[severity].verdict}`
        const tone = VERDICT_TONE[severity]
        return (
          <Fragment key={severity}>
            {/* Read as a list, not as one run of words, wherever the row is a description. */}
            {index === 0 ? undefined : <span className="sr-only">, </span>}
            {severity === 'warn' && onReview !== undefined ? (
              <button
                type="button"
                className={badgeStyles({ tone, className: styles.action() })}
                onClick={onReview}
              >
                {words}
              </button>
            ) : linked ? (
              <a
                href={`#${doctorGroupId(severity)}`}
                className={badgeStyles({ tone, className: styles.action() })}
              >
                {words}
              </a>
            ) : (
              <Badge tone={tone}>{words}</Badge>
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
