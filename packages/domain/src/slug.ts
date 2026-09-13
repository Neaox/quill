/**
 * The one way a human-readable name becomes a URL-safe word (ADR-035).
 *
 * Title slugs, document paths, workspace slugs, and collection slugs all come
 * from this function, so a document's path in the content store and the words
 * in its address are always the same words. The rules are deliberately dull —
 * no stop-word removal, no numbering, no reserved words — because a slug is
 * advisory: uniqueness is the short key's job, and predictability is worth
 * more here than brevity.
 *
 * An empty result is returned as an empty string rather than as a fallback
 * word: a URL simply omits the segment (`/d/<key>`), while a path or a
 * workspace slug, which must have a name, supplies its own `untitled`.
 */

/** Long enough for a real title, short enough to read in a link (ADR-035). */
export const MAX_SLUG_LENGTH = 80

const COMBINING_MARKS = /\p{Mn}/gu
/** Straight and typographic; `don't` becomes `dont`, never `don-t`. */
const APOSTROPHES = /['’]/gu
const SEPARATORS = /[^\p{Letter}\p{Number}]+/gu
const EDGE_HYPHENS = /^-+|-+$/gu

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replaceAll(COMBINING_MARKS, '')
    .toLowerCase()
    .replaceAll(APOSTROPHES, '')
    .replaceAll(SEPARATORS, '-')
    .replaceAll(EDGE_HYPHENS, '')
  return slug.length <= MAX_SLUG_LENGTH ? slug : cut(slug)
}

/**
 * The slug shortened to the limit at a word boundary.
 *
 * A slug cut mid-word reads as a typo, so the cut goes back to the last
 * hyphen before the limit; only a first word that is itself longer than the
 * limit has nowhere to go back to and is cut where it stands.
 */
function cut(slug: string): string {
  const head = slug.slice(0, MAX_SLUG_LENGTH)
  const boundary = head.lastIndexOf('-')
  return (boundary === -1 ? head : head.slice(0, boundary)).replaceAll(EDGE_HYPHENS, '')
}
