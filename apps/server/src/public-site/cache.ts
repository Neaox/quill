import type { Clock, PublicSite, ResolvedPublicMenu } from '@quill/application'

/**
 * What the public site remembers between requests (ADR-023, ADR-031).
 *
 * The anonymous surface is the one place where the cost of answering is an
 * amplification primitive rather than a slow query. Without this, every page
 * view read every document row in the collection and materialised effective
 * permissions over all of them, and then read the published Markdown out of
 * the content store to find out which render-cache entry it wanted — per
 * request, from no account at all, on a budget sized for a crawler.
 *
 * So these are kept, all in this process and all small:
 *
 * - **the resolved site**, keyed by its slug: which documents are on it, what
 *   each one's address is, how they nest, and what the organisation
 *   configured;
 * - **the finished page**, keyed by the site and the path: the HTML and its
 *   `ETag`;
 * - **a search's finished page**, keyed by the site, the question and the page
 *   of it. A search is the one request here whose cost a stranger chooses, so
 *   a question asked twice inside the window is answered from here, and these
 *   have a bound of their own: arbitrary questions from anywhere must not be
 *   able to push the pages readers are actually on out of memory;
 * - **the resolved header menu**, one for the whole instance because every
 *   page of every site carries the same one (`resolvePublicMenu`). It names
 *   documents on any site, which is why anything that changes one page
 *   invalidates everything: a rename in one collection changes the header of
 *   every site whose menu links to it.
 *
 * Neither is allowed to be the reason something is wrong, so both are bounded
 * three ways.
 *
 * **Events.** Publishing, renaming and moving a document all change what a
 * site shows, and all three are outbox events this server already consumes
 * (`public-site/invalidation.ts`, subscribed to the in-process bus, ADR-052). Publishing or
 * unpublishing a collection, and saving the organisation's settings, are
 * writes this server makes, and they invalidate on the way out.
 *
 * **Time.** Everything else — a grant written by hand, a document deleted — is
 * caught by a short time to live. It is deliberately no longer than the
 * `s-maxage` a page already carries, so this cache never makes a page staler
 * than a shared cache in front of the server is already allowed to make it
 * (`docs/architecture/public-site.md`, the caching section).
 *
 * **Size.** Both maps are bounded, oldest first, so a crawler working through
 * a large site cannot make the process grow without limit.
 *
 * The clock is injected, so a test can advance it and watch an entry expire
 * rather than sleeping.
 */

/** A page that has already been rendered, ready to send. */
export interface CachedPage {
  readonly html: string
  readonly etag: string
}

export interface PublicSiteCache {
  /** The site at this slug, or null when nothing valid is held. */
  site(siteSlug: string): PublicSite | null
  rememberSite(siteSlug: string, site: PublicSite): void
  page(siteSlug: string, path: string): CachedPage | null
  rememberPage(siteSlug: string, path: string, page: CachedPage): void
  /** The finished results page for this question, or null when nothing valid is held. */
  search(siteSlug: string, query: string, cursor: string | undefined): CachedPage | null
  rememberSearch(
    siteSlug: string,
    query: string,
    cursor: string | undefined,
    page: CachedPage,
  ): void
  /** The resolved header menu, or null when nothing valid is held. */
  menu(): ResolvedPublicMenu | null
  rememberMenu(menu: ResolvedPublicMenu): void
  /** Everything, because anything that changes one page can change the navigation on all of them. */
  invalidate(): void
}

export interface PublicSiteCacheOptions {
  readonly clock: Clock
  /** Zero disables the cache outright, which is what a test that is not about it wants. */
  readonly ttlMs: number
  readonly maxSites?: number
  readonly maxPages?: number
  readonly maxSearches?: number
}

/** Long enough to absorb a burst, never longer than the page's own `s-maxage`. */
export const PUBLIC_SITE_CACHE_TTL_MS = 15_000

const DEFAULT_MAX_SITES = 64
const DEFAULT_MAX_PAGES = 512
const DEFAULT_MAX_SEARCHES = 256

/**
 * One key for a page, from the two things that name it. A newline separates
 * them because a path cannot contain one and a slug cannot either, so no two
 * different pages can run together into the same key.
 */
const pageKey = (siteSlug: string, path: string): string => `${siteSlug}\n${path}`

/**
 * One key for a search. Unlike a path, a question can contain anything a
 * stranger types — a newline included — so the three parts are encoded rather
 * than joined, and no two different searches can run together into one key.
 */
const searchKey = (siteSlug: string, query: string, cursor: string | undefined): string =>
  JSON.stringify([siteSlug, cursor ?? null, query])

/** The one menu an instance has. */
const MENU_KEY = 'menu'

interface Entry<T> {
  readonly value: T
  readonly at: number
}

export function createPublicSiteCache(options: PublicSiteCacheOptions): PublicSiteCache {
  const maxSites = options.maxSites ?? DEFAULT_MAX_SITES
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const maxSearches = options.maxSearches ?? DEFAULT_MAX_SEARCHES
  const sites = new Map<string, Entry<PublicSite>>()
  const pages = new Map<string, Entry<CachedPage>>()
  const searches = new Map<string, Entry<CachedPage>>()
  const menus = new Map<string, Entry<ResolvedPublicMenu>>()

  /**
   * A `Map` iterates in insertion order, so deleting the first key evicts the
   * oldest entry — and re-inserting a key it already holds keeps its original
   * place, which is what makes this oldest-first rather than least-recently-used.
   * That is the behaviour wanted here: an entry's value is only ever valid for
   * `ttlMs` from when it was *written*, so reading it must not extend its life.
   */
  const remember = <T>(into: Map<string, Entry<T>>, key: string, value: T, max: number): void => {
    if (options.ttlMs <= 0) return
    into.delete(key)
    into.set(key, { value, at: options.clock.now().getTime() })
    for (const oldest of into.keys()) {
      if (into.size <= max) break
      into.delete(oldest)
    }
  }

  const recall = <T>(from: Map<string, Entry<T>>, key: string): T | null => {
    const entry = from.get(key)
    if (entry === undefined) return null
    if (options.clock.now().getTime() - entry.at >= options.ttlMs) {
      from.delete(key)
      return null
    }
    return entry.value
  }

  return {
    site: (siteSlug) => recall(sites, siteSlug),
    rememberSite: (siteSlug, site) => remember(sites, siteSlug, site, maxSites),
    page: (siteSlug, path) => recall(pages, pageKey(siteSlug, path)),
    rememberPage: (siteSlug, path, page) =>
      remember(pages, pageKey(siteSlug, path), page, maxPages),
    search: (siteSlug, query, cursor) => recall(searches, searchKey(siteSlug, query, cursor)),
    rememberSearch: (siteSlug, query, cursor, page) =>
      remember(searches, searchKey(siteSlug, query, cursor), page, maxSearches),
    menu: () => recall(menus, MENU_KEY),
    rememberMenu: (menu) => remember(menus, MENU_KEY, menu, 1),
    invalidate: () => {
      sites.clear()
      pages.clear()
      searches.clear()
      menus.clear()
    },
  }
}
