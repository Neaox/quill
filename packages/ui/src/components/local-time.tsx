import {
  FULL_MOMENT,
  formatMoment,
  toMoment,
  type MomentStyle,
  type MomentValue,
} from '../lib/time/moment.ts'

export interface LocalTimeProps {
  readonly value: MomentValue
  /** How much of it to say: a date, a month and day, a date and time, or a time; or the `Intl` options for something else. */
  readonly format?: MomentStyle | Intl.DateTimeFormatOptions
  /** A language, when it should not be the reader's own. */
  readonly locale?: string | undefined
  /** What hovering shows. The whole moment by default. */
  readonly title?: MomentStyle | Intl.DateTimeFormatOptions
  readonly className?: string | undefined
}

/**
 * A moment written out ("12 Oct", "12 Oct 2026, 14:05") as a `<time>`, in the reader's own
 * language and calendar (`Intl`), and in full when hovered. For a moment that is a date and
 * stays one ("expires", "created"); `RelativeTime` is for how long ago.
 */
export function LocalTime({ value, format = 'date', locale, title, className }: LocalTimeProps) {
  const moment = toMoment(value)
  if (moment === undefined) return undefined
  return (
    <time
      dateTime={moment.toISOString()}
      title={formatMoment(moment, title ?? FULL_MOMENT, locale)}
      className={className}
    >
      {formatMoment(moment, format, locale)}
    </time>
  )
}
