/**
 * The sitemap and `robots.txt` (use case 29, ADR-023).
 *
 * The sitemap lists **current paths only**. That is the whole promise ADR-035
 * makes in exchange for path-shaped public URLs: an address that has moved is
 * answered with a `301` when somebody asks for it, and is never offered to a
 * crawler as a thing to index. So the sitemap is generated from the site's
 * page table on every request and never from the redirect table.
 *
 * XML, not HTML, so it has its own escape: the five predefined entities, and
 * nothing that decodes back to markup.
 */

const XML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&apos;'],
])

function escapeXml(value: string): string {
  /* v8 ignore next -- every character the pattern matches is in the map. */
  return value.replaceAll(/[&<>"']/gu, (character) => XML_ESCAPES.get(character) ?? character)
}

export interface SitemapEntry {
  /** The absolute address of the page. */
  readonly loc: string
  /** When its head revision was published (ADR-031's revisions index). */
  readonly lastmod: Date
}

export function renderSitemap(entries: readonly SitemapEntry[]): string {
  const urls = entries.map(
    (entry) =>
      `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n` +
      `    <lastmod>${entry.lastmod.toISOString()}</lastmod>\n  </url>`,
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

/**
 * An index of sitemaps, for a site with more addresses than one sitemap lists.
 *
 * No `lastmod`: it would be the newest stamp on the page it points at, which
 * costs the walk this index exists to avoid, and a crawler fetches the page
 * itself to find out either way.
 */
export function renderSitemapIndex(locations: readonly string[]): string {
  const entries = locations.map(
    (loc) => `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n  </sitemap>`,
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</sitemapindex>',
    '',
  ].join('\n')
}

export interface RobotsView {
  /** The instance's own address, so every line is absolute where it has to be. */
  readonly appUrl: string
  /** The slug of every site whose switch is on. */
  readonly siteSlugs: readonly string[]
}

/**
 * `robots.txt`, saying plainly what may be indexed.
 *
 * Public pages are allowed and everything else is not — the API, the
 * application's own routes, and share links, which carry a capability in the
 * path and must never be in an index (ADR-011, `docs/product/surfaces.md`).
 * The `Disallow` lines are a courtesy to well-behaved crawlers and nothing
 * more: every one of those routes refuses an anonymous request on its own.
 */
export function renderRobots(view: RobotsView): string {
  return [
    'User-agent: *',
    'Allow: /s/',
    // The pictures on a published page are attachment URLs, because that is
    // what the Markdown sanitiser admits as an image source (ADR-023, H1 of
    // the review): they are part of the page, so they are allowed. `Allow`
    // precedes the `Disallow` it narrows, which is how the longest-match rule
    // in the robots exclusion standard resolves the pair.
    'Allow: /api/attachments/',
    'Disallow: /api/',
    'Disallow: /share/',
    'Disallow: /w/',
    'Disallow: /admin/',
    '',
    ...view.siteSlugs.map((slug) => `Sitemap: ${view.appUrl}/s/${slug}/sitemap.xml`),
    '',
  ].join('\n')
}
