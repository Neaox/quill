/**
 * Ranking what the author typed after the slash.
 *
 * Four tiers, best first, the way Notion and Linear order a command list:
 *
 * 1. the label starts with the query (`ta` → Table), or an alias is exactly it (`h2`);
 * 2. every word of the query starts a word of the label (`call warn` → Callout: Warning);
 * 3. a keyword or alias starts with the query (`admonition` → the callouts);
 * 4. the query's letters appear in the label in order, from a word's start
 *    (`bllst` → Bulleted list).
 *
 * Within a tier the catalogue's own order stands, which keeps the menu
 * stable as the author types. Each match says which characters of the label
 * it matched, so the menu can mark them.
 */

export interface Rankable {
  readonly label: string
  readonly keywords?: readonly string[]
  readonly aliases?: readonly string[]
}

/** A half-open range of label characters, `[start, end)`. */
export interface MatchRange {
  readonly start: number
  readonly end: number
}

export interface RankedMatch<T> {
  readonly item: T
  readonly ranges: readonly MatchRange[]
}

interface Scored<T> extends RankedMatch<T> {
  readonly tier: number
  readonly order: number
}

/** Where each word of a label starts, lower-cased, worked out once per label. */
interface LabelWords {
  readonly lower: string
  readonly starts: readonly number[]
}

const words = new Map<string, LabelWords>()

function labelWords(label: string): LabelWords {
  const known = words.get(label)
  if (known !== undefined) return known
  const lower = label.toLowerCase()
  const starts = [...lower.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match.index)
  const computed = { lower, starts }
  words.set(label, computed)
  return computed
}

/** Each query word against the label's word starts, in order, or undefined if one has none. */
function wordStarts(label: LabelWords, query: readonly string[]): MatchRange[] | undefined {
  const ranges: MatchRange[] = []
  let from = 0
  for (const word of query) {
    const start = label.starts.find(
      (candidate) => candidate >= from && label.lower.startsWith(word, candidate),
    )
    if (start === undefined) return undefined
    ranges.push({ start, end: start + word.length })
    from = start + word.length
  }
  return ranges
}

/** The query's characters in the label, in order, as runs; undefined when they are not all there. */
function subsequence(label: string, query: string): MatchRange[] | undefined {
  const ranges: MatchRange[] = []
  let at = 0
  for (const character of query) {
    if (character === ' ') continue
    const found = label.indexOf(character, at)
    if (found < 0) return undefined
    const last = ranges.at(-1)
    if (last !== undefined && last.end === found)
      ranges[ranges.length - 1] = { ...last, end: found + 1 }
    else ranges.push({ start: found, end: found + 1 })
    at = found + 1
  }
  return ranges
}

function score<T extends Rankable>(
  item: T,
  needle: string,
  terms: readonly string[],
): Omit<Scored<T>, 'order'> | undefined {
  const label = labelWords(item.label)
  const aliases = item.aliases ?? []
  if (label.lower.startsWith(needle)) {
    return { item, tier: 0, ranges: [{ start: 0, end: needle.length }] }
  }
  if (aliases.includes(needle)) return { item, tier: 0, ranges: [] }
  const starts = wordStarts(label, terms)
  if (starts !== undefined) return { item, tier: 1, ranges: starts }
  const names = [...(item.keywords ?? []), ...aliases]
  if (names.some((name) => name.startsWith(needle))) return { item, tier: 2, ranges: [] }
  if (needle.length < 2) return undefined
  // Letters in order, starting at the start of a word: `bllst` finds
  // Bulleted list, but `code` does not find Placeholder.
  const letters = subsequence(label.lower, needle)
  return letters?.[0] === undefined || !label.starts.includes(letters[0].start)
    ? undefined
    : { item, tier: 3, ranges: letters }
}

/**
 * The items that match a query, best first, with the label characters that
 * matched. An empty query matches everything, in catalogue order.
 */
export function rankMatches<T extends Rankable>(
  query: string,
  items: readonly T[],
): readonly RankedMatch<T>[] {
  const needle = query.trim().toLowerCase().replaceAll(/\s+/g, ' ')
  if (needle === '') return items.map((item) => ({ item, ranges: [] }))
  const terms = needle.split(' ')
  const scored: Scored<T>[] = []
  for (const [order, item] of items.entries()) {
    const found = score(item, needle, terms)
    if (found !== undefined) scored.push({ ...found, order })
  }
  return scored
    .toSorted((a, b) => a.tier - b.tier || a.order - b.order)
    .map(({ item, ranges }) => ({ item, ranges }))
}

/** The label split into matched and unmatched runs, for drawing the matched ones marked. */
export interface LabelPart {
  readonly text: string
  readonly matched: boolean
  /** Where the part starts in the label, which also names it uniquely. */
  readonly start: number
}

export function highlight(label: string, ranges: readonly MatchRange[]): readonly LabelPart[] {
  const parts: LabelPart[] = []
  let at = 0
  for (const { start, end } of ranges) {
    if (start > at) parts.push({ text: label.slice(at, start), matched: false, start: at })
    parts.push({ text: label.slice(start, end), matched: true, start })
    at = end
  }
  if (at < label.length) parts.push({ text: label.slice(at), matched: false, start: at })
  return parts
}
