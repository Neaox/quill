/** Turns heading text into an identifier, once per document. */
export type Slugger = (text: string) => string

const PUNCTUATION = /[^\p{L}\p{N}\s-]/gu
const WHITESPACE = /\s+/g

/**
 * What a heading's slug is prefixed with in the rendered HTML.
 *
 * A slug comes from the author's own heading text, so without a prefix a
 * document could mint `id="main"`, `id="search"` or `id="config"` — colliding
 * with the application's own ids and, worse, clobbering same-named globals and
 * `document.getElementById` lookups from inside the document body. The renderer
 * hands the raw slug to `hast-util-sanitize`, whose `clobberPrefix` adds this to
 * every `id` and `name` it lets through (`render/sanitize-schema.ts`), so the
 * prefix is applied in exactly one place. Everything that has to point *at* a
 * heading — the anchor's own `href`, `extractOutline`'s ids, and therefore the
 * table of contents — adds it here instead, because the sanitiser only rewrites
 * the attributes it clobbers and never the references to them.
 */
export const HEADING_ID_PREFIX = 'user-content-'

/** The identifier a rendered heading actually carries, for anything linking to it. */
export function headingId(slug: string): string {
  return `${HEADING_ID_PREFIX}${slug}`
}

/**
 * Stable, readable heading identifiers in the shape readers already know from
 * repository hosts, deduplicated within a document so every heading is linkable.
 * The renderer and `extractOutline` share this function, so a table of contents
 * entry always points at the heading it names.
 */
export function createSlugger(): Slugger {
  const seen = new Map<string, number>()
  return (text: string): string => {
    const cleaned = text
      .toLowerCase()
      .trim()
      .replaceAll(PUNCTUATION, '')
      .replaceAll(WHITESPACE, '-')
    const base = cleaned.length > 0 ? cleaned : 'section'
    const taken = seen.get(base) ?? 0
    seen.set(base, taken + 1)
    return taken === 0 ? base : `${base}-${taken}`
  }
}
