/**
 * "3 days ago", "yesterday", "just now": how long ago a timestamp was, said
 * the way a person says it, in the browser's own language.
 *
 * Pure: "now" is the caller's, captured once from `clock.ts`, so a list of
 * dates does not tick while somebody reads it and a test can pin it.
 */

const UNITS: readonly { readonly unit: Intl.RelativeTimeFormatUnit; readonly seconds: number }[] = [
  { unit: 'year', seconds: 365 * 24 * 60 * 60 },
  { unit: 'month', seconds: 30 * 24 * 60 * 60 },
  { unit: 'week', seconds: 7 * 24 * 60 * 60 },
  { unit: 'day', seconds: 24 * 60 * 60 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
]

/** Under this, "just now" says more than "in 0 minutes" or "12 seconds ago". */
const JUST_NOW_SECONDS = 45

const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function relativeTime(timestamp: string, nowMs: number): string {
  const elapsed = (nowMs - Date.parse(timestamp)) / 1000
  if (Number.isNaN(elapsed)) return ''
  if (Math.abs(elapsed) < JUST_NOW_SECONDS) return 'just now'
  const { unit, seconds } = UNITS.find((candidate) => Math.abs(elapsed) >= candidate.seconds) ?? {
    unit: 'minute',
    seconds: 60,
  }
  return format.format(-Math.round(elapsed / seconds), unit)
}
