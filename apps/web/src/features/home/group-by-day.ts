export interface DayGroup<T> {
  /** What the day is called: "Today", "Friday", "20 September". */
  readonly label: string
  readonly items: readonly T[]
}

const DAY_MS = 86_400_000

/** Midnight at the start of the reader's own day. */
function startOfDay(moment: number): number {
  const date = new Date(moment)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** How a day is named: close days by word or weekday, further ones by date. */
function dayLabel(moment: number, now: number, locale: string | undefined): string {
  // Rounded rather than floored: a daylight-saving day is 23 or 25 hours long.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(moment)) / DAY_MS)
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(moment)
  const sameYear = new Date(moment).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(moment)
}

/**
 * Splits a newest-first list into the days it spans, so a row need not repeat
 * "14 hours ago" when its heading already says "Today". Consecutive rows with
 * the same label share a group; the order is the one given.
 */
export function groupByDay<T>(
  items: readonly T[],
  updatedAt: (item: T) => string,
  now: number,
  locale?: string,
): DayGroup<T>[] {
  const groups: { label: string; items: T[] }[] = []
  for (const item of items) {
    const label = dayLabel(Date.parse(updatedAt(item)), now, locale)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
