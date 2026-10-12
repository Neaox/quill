import { RECENT_LIMIT } from './slash-recents.ts'
import { rankMatches } from './slash-rank.ts'
import type { RankedMatch } from './slash-rank.ts'
import type { SlashItem } from './slash-item.ts'

/**
 * What the menu lists for a query, in sections.
 *
 * With nothing typed: the recently used items first, then every item under
 * its group's heading. With a query: one list, best match first — a heading
 * per group would put a weak match above a strong one because its group
 * comes earlier.
 */

export interface SlashSection {
  /** The heading, or null for the ranked list a query gives. */
  readonly title: string | null
  readonly matches: readonly RankedMatch<SlashItem>[]
}

export const RECENT_TITLE = 'Recently used'

export function slashSections(
  query: string,
  items: readonly SlashItem[],
  recentIds: readonly string[],
): readonly SlashSection[] {
  if (query.trim() !== '') {
    const matches = rankMatches(query, items)
    return matches.length === 0 ? [] : [{ title: null, matches }]
  }
  const recent = recentIds
    .flatMap((id) => items.filter((item) => item.id === id))
    .slice(0, RECENT_LIMIT)
  const groups = Map.groupBy(items, (item) => item.group)
  return [
    ...(recent.length === 0
      ? []
      : [{ title: RECENT_TITLE, matches: recent.map((item) => ({ item, ranges: [] })) }]),
    ...[...groups].map(([title, members]) => ({
      title,
      matches: members.map((item) => ({ item, ranges: [] })),
    })),
  ]
}

/** The sections as one list, which is what the keyboard moves through. */
export function flatten(sections: readonly SlashSection[]): readonly RankedMatch<SlashItem>[] {
  return sections.flatMap((section) => section.matches)
}
