/**
 * How long ago a moment was, said the way a person says it, in the reader's language, and
 * when that saying next changes.
 *
 * Pure: the clock is an argument. "Next changes" is what lets a page of a thousand times be
 * kept up to date by one timer set for the earliest moment any of them reads differently,
 * rather than a thousand timers ticking every second (`clock-store.ts`).
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
export const JUST_NOW_SECONDS = 45

/** The word for under a minute. English until the interface is localised (`quill-plan.md`, question 8). */
const JUST_NOW = 'just now'

const MS = 1000

/** The platform's own formatter for a language, made once: a page of times asks for it per time. */
const formatters = new Map<string, Intl.RelativeTimeFormat>()

function relativeFormat(locale: string | undefined): Intl.RelativeTimeFormat {
  const key = locale ?? ''
  const held = formatters.get(key)
  if (held !== undefined) return held
  const made = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  formatters.set(key, made)
  return made
}

/** The unit a distance is said in, and how many seconds one of it is. */
function unitFor(seconds: number): (typeof UNITS)[number] {
  return UNITS.find((candidate) => seconds >= candidate.seconds) ?? { unit: 'minute', seconds: 60 }
}

/** "2 minutes ago", "yesterday", "in 3 hours", or "just now" under a minute (a little under). */
export function elapsedLabel(atMs: number, nowMs: number, locale?: string): string {
  const elapsed = (nowMs - atMs) / MS
  if (Number.isNaN(elapsed)) return ''
  const distance = Math.abs(elapsed)
  if (distance < JUST_NOW_SECONDS) return JUST_NOW
  const { unit, seconds } = unitFor(distance)
  return relativeFormat(locale).format(-Math.round(elapsed / seconds), unit)
}

/**
 * The moment, at or after `nowMs`, when `elapsedLabel` would say something else: when "just
 * now" gives way to a minute, when a minute becomes two, and so on, past or future. Never
 * sooner than a second, so that a time on the cusp cannot make a timer spin.
 */
export function nextChangeAt(atMs: number, nowMs: number): number {
  const elapsed = (nowMs - atMs) / MS
  if (Number.isNaN(elapsed)) return Number.POSITIVE_INFINITY
  const past = elapsed >= 0
  const distance = Math.abs(elapsed)

  // The distance at which the saying changes, going outwards in time for the past (it grows)
  // and inwards for the future (it shrinks).
  let boundary: number
  if (distance < JUST_NOW_SECONDS) {
    boundary = JUST_NOW_SECONDS
  } else {
    const { seconds } = unitFor(distance)
    const count = Math.round(distance / seconds)
    if (past) {
      // Going outwards, the next unit up takes over where it begins, which can be before the
      // count rounds again (59 minutes and a half is "60 minutes", and 3600 seconds is "1 hour").
      const above = UNITS.toReversed().find(
        (candidate) => candidate.seconds > Math.max(seconds, distance),
      )
      boundary = Math.min((count + 0.5) * seconds, above?.seconds ?? Number.POSITIVE_INFINITY)
    } else {
      // Going inwards, the unit gives way to a smaller where it ends, which can be before the
      // count rounds down.
      boundary = Math.max((count - 0.5) * seconds, seconds)
    }
  }
  const at = past ? atMs + boundary * MS : atMs - boundary * MS
  return Math.max(at, nowMs + MS)
}
