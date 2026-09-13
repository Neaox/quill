import { tv } from '@quill/ui'

import type { HealthSignal } from '../../lib/api/index.ts'

/**
 * Quiet by construction: metadata type, muted colour, and a dot that only
 * carries the accent for the one signal that is a deadline. ADR-029 is
 * explicit that an unfilled required section "shows as a quiet quality
 * indicator, the same family as 'no owner' or 'review overdue', never as an
 * error", so none of these is a callout, a badge, or a colour with a warning
 * in it.
 */
export const healthSignalStyles = tv({
  slots: {
    root: '',
    heading: 'meta pb-2',
    list: 'flex flex-col gap-1.5',
    item: 'meta-value flex items-start gap-2',
    dot: 'mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong data-[kind=review-overdue]:bg-accent',
    detail: 'text-muted/80',
  },
})

/** What each signal is called, in words, so nothing depends on the dot. */
const SIGNAL_LABEL: Readonly<Record<HealthSignal['kind'], string>> = {
  'no-owner': 'no owner',
  'review-overdue': 'review overdue',
  'required-section-empty': 'section empty',
  'broken-link': 'broken link',
}

export interface HealthSignalsProps {
  readonly signals: readonly HealthSignal[]
  readonly label?: string
  readonly className?: string | undefined
}

export function HealthSignals({ signals, label = 'Signals', className }: HealthSignalsProps) {
  if (signals.length === 0) return undefined

  const styles = healthSignalStyles()

  return (
    <section aria-label={label} className={styles.root({ className })}>
      <p className={styles.heading()}>{label}</p>
      <ul className={styles.list()}>
        {signals.map((signal) => (
          <li key={`${signal.kind}:${signal.detail ?? ''}`} className={styles.item()}>
            <span aria-hidden="true" data-kind={signal.kind} className={styles.dot()} />
            <span>
              {SIGNAL_LABEL[signal.kind]}
              {signal.detail === undefined ? undefined : (
                <span className={styles.detail()}> — {signal.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
