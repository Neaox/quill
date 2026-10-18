/**
 * Dates as a reader says them.
 *
 * Calendar dates in front matter (`lastReviewed: 2026-03-01`) are days, not
 * instants, so both readings are in UTC: a reader east of Greenwich must not
 * see the review that happened on the first as the twenty-eighth.
 *
 * Relative time is for the application, which has a "now"; a page served from
 * a cache uses `absoluteDate` alone (`docs/design/properties.md`).
 */

const ABSOLUTE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const DAY = 24 * 60 * 60 * 1000

/** `1 Mar 2026`. */
export function absoluteDate(date: Date): string {
  return ABSOLUTE.format(date)
}

/** The instant a date's UTC day starts. */
function startOfDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
}

/** Whole days from the start of `now`'s UTC day to the start of `date`'s. */
function daysBetween(date: Date, now: Date): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY)
}

/** `today`, `yesterday`, `5 days ago`, `in 3 months`: the largest unit that fits. */
export function relativeDate(date: Date, now: Date): string {
  const days = daysBetween(date, now)
  const size = Math.abs(days)
  if (size < 7) return RELATIVE.format(days, 'day')
  if (size < 30) return RELATIVE.format(Math.trunc(days / 7), 'week')
  if (size < 365) return RELATIVE.format(Math.trunc(days / 30), 'month')
  return RELATIVE.format(Math.trunc(days / 365), 'year')
}
