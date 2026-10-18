/**
 * Tags are a hierarchy (ADR-010, amendment of 2026-10-17): `/` separates a tag
 * from its parent, so `area/billing` sits under `area`, and asking for a tag
 * finds the documents tagged with it or with anything below it.
 *
 * This file is the one reading of what a tag is. The projection, the
 * PostgreSQL adapter and the in-memory double all call it, and the SQL that
 * backfilled existing rows (migration 0017) mirrors it, so there is no second
 * opinion about case, spaces or separators to drift.
 */

const SEPARATOR = '/'

/**
 * A tag as it is compared: lower case, with the space around it and around
 * each segment removed and empty segments dropped (`a//b`, `/a`, `a/` and
 * `a / b` are `a/b`'s neighbours, not new tags). Null when nothing is left, so
 * a tag that was only separators is not a tag.
 */
export function normaliseTag(tag: string): string | null {
  const segments = tag
    .toLowerCase()
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
  return segments.length === 0 ? null : segments.join(SEPARATOR)
}

/**
 * Every tag and every ancestor of every tag, normalised and de-duplicated, in
 * the order each was first reached (a parent before its children). This is
 * what `tag:` is matched against: `area/billing` yields `area` and
 * `area/billing`, so `tag:area` finds it and `tag:area/billing` finds only that
 * subtree.
 */
export function expandTagPaths(tags: readonly string[]): readonly string[] {
  const paths = new Set<string>()
  for (const tag of tags) {
    const normalised = normaliseTag(tag)
    if (normalised === null) continue
    const segments = normalised.split(SEPARATOR)
    for (let depth = 1; depth <= segments.length; depth += 1) {
      paths.add(segments.slice(0, depth).join(SEPARATOR))
    }
  }
  return [...paths]
}
