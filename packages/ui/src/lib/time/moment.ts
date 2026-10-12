/**
 * A moment, said in the reader's own language and calendar (`Intl`), never in a format of ours.
 *
 * Formatters are made once per language and set of options: a page can hold a thousand times,
 * and a formatter costs far more to make than to use.
 */

export type MomentValue = string | number | Date

/** The ways a moment is written out. Each is a set of `Intl` options, so the language is the reader's. */
export type MomentStyle = 'date' | 'month-day' | 'datetime' | 'time'

const OPTIONS: Readonly<Record<MomentStyle, Intl.DateTimeFormatOptions>> = {
  date: { dateStyle: 'medium' },
  'month-day': { day: 'numeric', month: 'short' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
}

/** What hovering a time shows: all of it, so the short saying never costs anyone the exact one. */
export const FULL_MOMENT: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'long' }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  const held = formatters.get(key)
  if (held !== undefined) return held
  const made = new Intl.DateTimeFormat(locale, options)
  formatters.set(key, made)
  return made
}

/** The moment as milliseconds since the epoch, or NaN when the value is not one. */
export function toMilliseconds(value: MomentValue): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/** The moment as a `Date`, or nothing when the value is not one. */
export function toMoment(value: MomentValue): Date | undefined {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function formatMoment(
  value: Date,
  style: MomentStyle | Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return formatter(locale, typeof style === 'string' ? OPTIONS[style] : style).format(value)
}
