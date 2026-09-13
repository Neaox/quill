import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  loadPublicSite,
  publicPageHref,
  publicSiteHref,
  publishedAt,
  renderDocument,
} from '@quill/application'
import type { DocumentRow, PublicSite } from '@quill/application'
import { PUBLIC_PRINCIPAL } from '@quill/domain'
import type { WorkspaceId } from '@quill/domain'
import { visibilityFilter } from '@quill/search'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { notFound } from '../errors.ts'
import type { CachedPage } from '../public-site/cache.ts'
import {
  articleStructuredData,
  firstParagraph,
  renderDocumentMain,
  renderIndexMain,
  renderNoSitePage,
  renderNotFoundMain,
  renderSearchMain,
} from '../public-site/pages.ts'
import type { SearchResultView } from '../public-site/pages.ts'
import { renderRobots, renderSitemap, renderSitemapIndex } from '../public-site/sitemap.ts'
import { ASSET_MAX_AGE_SECONDS } from '../public-site/stylesheet.ts'
import { renderPage } from '../public-site/templates/page.ts'
import { addressRateLimit } from '../plugins/rate-limit.ts'
import { unsearchable } from './search-query.ts'

/**
 * The public site (ADR-023, ADR-035; `docs/architecture/public-site.md`).
 *
 * These routes answer with HTML, not JSON, and they are deliberately not part
 * of the API: nothing here is in the OpenAPI description or the generated
 * client, because a page is not an endpoint and a crawler is not a client
 * (`docs/product/surfaces.md`).
 *
 * What makes this surface different from every other one in the server:
 *
 * - **No session is read.** Not by a `preHandler`, not by a cookie check, not
 *   anywhere. A public page is the same page for everybody who asks for it,
 *   which is what lets it be cached for everybody who asks for it, and it is
 *   the same rule the share-link surface follows for the opposite reason.
 * - **The reader is the public principal**, so a document carved out with a
 *   deny at document scope is absent from the navigation, from the sitemap and
 *   from its own address (ADR-012's amendment, use case 30).
 * - **Only published revisions exist.** `loadPublicSite` keeps documents with
 *   no head revision out of the site entirely, and the body comes from the
 *   render cache's published entry (ADR-031) — there is no path through this
 *   file that can reach a draft.
 * - **Rate limited per source address**, because the surface is anonymous and
 *   a crawler that misbehaves must not cost the instance more than it is worth
 *   (`docs/product/personas.md`).
 * - **Never `noindex` on a published document.** That header belongs to share
 *   links. The search results and the not-found page are not published
 *   documents and do carry it, so an address whose text anybody can choose
 *   never becomes an indexable page under the organisation's name.
 * - **Answered from an in-process cache** (`public-site/cache.ts`), because
 *   the cost of resolving a site is an amplification primitive in front of no
 *   account at all. The cache is invalidated by the events the server already
 *   consumes and by its own writes, and expires on a clock in any case.
 */

/** One budget for the whole anonymous HTML surface, keyed by source address. */
export const PUBLIC_SITE_BUCKET = 'public-site'

/** How long a shared cache may hold a page before asking again (ADR-031). */
export const PAGE_SHARED_MAX_AGE_SECONDS = 60

const SiteParams = Type.Object({ siteSlug: Type.String({ minLength: 1, maxLength: 200 }) })
const PageParams = Type.Object({
  siteSlug: Type.String({ minLength: 1, maxLength: 200 }),
  '*': Type.String({ maxLength: 400 }),
})
const AssetParams = Type.Object({ file: Type.String({ maxLength: 100 }) })
const SearchQuery = Type.Object({ q: Type.Optional(Type.String({ maxLength: 512 })) })
const SitemapPageParams = Type.Object({
  siteSlug: Type.String({ minLength: 1, maxLength: 200 }),
  page: Type.String({ maxLength: 10 }),
})

/**
 * What the search results and the not-found page tell a crawler.
 *
 * `follow`, because the links on them lead to pages that *should* be indexed;
 * `noindex`, because the page itself is an address whose text the person
 * following the link chose, and it would otherwise be an indexable page under
 * the organisation's name saying whatever they typed.
 */
const NOT_A_PUBLISHED_DOCUMENT = 'noindex,follow'

/** The cache key for a site's home, which has no path of its own. */
const HOME_PATH = ''

/** `theme-<32 hex characters>.css`, and nothing else. */
const ASSET_FILE = /^theme-([0-9a-f]{32})\.css$/u

export function publicSiteRoutes(deps: AppDependencies): FastifyPluginAsync {
  const budget = addressRateLimit(PUBLIC_SITE_BUCKET, deps.config.publicSiteRateLimitMax)
  const pageSize = deps.config.publicSitemapPageSize

  /** The absolute form of a path on this instance, for canonical links and the sitemap. */
  const absolute = (path: string): string => `${deps.config.appUrl}${path}`

  /**
   * Sends HTML with the validator every page carries.
   *
   * The tag is a hash of the finished page, which is the whole of its
   * identity: the revision it was rendered from, the theme that styled it and
   * the navigation around it all change the bytes, so a tag of the body alone
   * — or of the revision alone — would tell a reader nothing had changed when
   * something had (the same reasoning as ADR-031's tag on the rendered route).
   * Nothing on the page varies per response — there is no nonce on it (see
   * `templates/page.ts`) — so the page *is* its identity, and two readers
   * asking for the same page get the same bytes and the same tag.
   */
  const sendPage = (
    request: FastifyRequest,
    reply: FastifyReply,
    page: CachedPage,
    status = 200,
  ): FastifyReply => {
    reply.header('etag', page.etag)
    reply.header(
      'cache-control',
      status === 200
        ? `public, max-age=0, s-maxage=${PAGE_SHARED_MAX_AGE_SECONDS}`
        : 'public, max-age=0, no-cache',
    )
    reply.type('text/html; charset=utf-8')
    if (status === 200 && request.headers['if-none-match'] === page.etag) {
      return reply.status(304).send()
    }
    return reply.status(status).send(page.html)
  }

  /** A rendered page and the tag that identifies it. */
  const finished = (html: string): CachedPage => ({
    html,
    etag: `"${deps.hasher.contentHash(html)}"`,
  })

  /** Everything the shell needs that is the same on every page of a site. */
  const shellOf = (site: PublicSite) => {
    const stylesheet = deps.publicStylesheets.forTheme(site.organisation.theme)
    return {
      siteSlug: site.siteSlug,
      siteName: site.organisation.name,
      links: site.organisation.publicNavigation,
      navigation: site.navigation,
      stylesheetHref: stylesheet.href,
    }
  }

  const notFoundPage = (request: FastifyRequest, reply: FastifyReply, site: PublicSite) =>
    sendPage(
      request,
      reply,
      finished(
        renderPage({
          ...shellOf(site),
          currentPath: null,
          title: 'Not found',
          description: null,
          // No canonical: this address is not the authoritative home of
          // anything, and saying it was would invite it into an index.
          canonical: null,
          robots: NOT_A_PUBLISHED_DOCUMENT,
          outline: [],
          main: renderNotFoundMain({ siteSlug: site.siteSlug }),
          updatedAt: null,
          structuredData: null,
          query: null,
        }),
      ),
      404,
    )

  /**
   * A miss that is not *within* a site: an unknown slug, a site taken down, an
   * organisation that no longer publishes, settings this release cannot read.
   *
   * It is still HTML, because everything else this surface answers with is —
   * a crawler or a reader meeting the platform's JSON error shape here would
   * be meeting the application, which is the one thing a public address must
   * never show. It carries no site name and no navigation, because there is no
   * site: the four reasons stay indistinguishable (ADR-011).
   */
  const noSitePage = (request: FastifyRequest, reply: FastifyReply) =>
    sendPage(request, reply, finished(renderNoSitePage()), 404)

  /**
   * The site at this slug, from the cache when it is fresh.
   *
   * `null` is the one answer every reason gives, and the caller turns it into
   * the page above.
   */
  const siteAt = async (siteSlug: string): Promise<PublicSite | null> => {
    const known = deps.publicSiteCache.site(siteSlug)
    if (known !== null) return known
    const loaded = await loadPublicSite(deps, siteSlug)
    if (loaded.kind !== 'site') return null
    deps.publicSiteCache.rememberSite(siteSlug, loaded.site)
    return loaded.site
  }

  /**
   * One page of a site's addresses, newest-first stamps and all.
   *
   * The order is the address, so the pages of a large site's sitemap are
   * stable between requests: a crawler working through them must not be handed
   * a different slice because two documents were published in between.
   */
  const sitemapEntries = async (site: PublicSite, page: number) => {
    const ordered = [...site.pages]
      .map(([path, document]) => ({ path, document }))
      .toSorted((left, right) => left.path.localeCompare(right.path))
    const slice = ordered.slice((page - 1) * pageSize, page * pageSize)
    const stamps = await publishedAt(
      deps,
      slice.map((entry) => entry.document),
    )
    const pages = slice.map((entry) => ({
      loc: absolute(publicPageHref(site.siteSlug, entry.path)),
      /* v8 ignore next -- every page's document was just passed to `publishedAt`. */
      lastmod: stamps.get(entry.document.id) ?? entry.document.updatedAt,
    }))
    // The site's own address belongs on the first page and nowhere else.
    return page === 1
      ? [
          {
            loc: absolute(publicSiteHref(site.siteSlug)),
            lastmod: newest(stamps.values()) ?? site.collection.createdAt,
          },
          ...pages,
        ]
      : pages
  }

  /** A document page, rendered from the cache (ADR-031). */
  const documentPage = async (
    request: FastifyRequest,
    reply: FastifyReply,
    site: PublicSite,
    document: DocumentRow,
    path: string,
  ) => {
    const held = deps.publicSiteCache.page(site.siteSlug, path)
    if (held !== null) return sendPage(request, reply, held)

    // The link index is not touched: an anonymous `GET` must not make the
    // server write, and the publish path maintains it on every revision.
    const rendered = await renderDocument(deps, { documentId: document.id, indexLinks: false })
    /* v8 ignore next 2 -- the site only holds documents with a head revision. */
    if (rendered.kind !== 'rendered') return notFoundPage(request, reply, site)

    const stamps = await publishedAt(deps, [document])
    /* v8 ignore next -- `publishedAt` answers for every document it is given. */
    const updatedAt = stamps.get(document.id) ?? document.updatedAt
    const canonical = absolute(publicPageHref(site.siteSlug, path))
    const description = firstParagraph(rendered.content.text)

    const page = finished(
      renderPage({
        ...shellOf(site),
        currentPath: path,
        title: document.title,
        description,
        canonical,
        robots: null,
        outline: rendered.content.outline,
        main: renderDocumentMain({
          collectionName: site.collection.name,
          title: document.title,
          bodyHtml: rendered.content.html,
          rules: site.organisation.layout.default.rules,
        }),
        updatedAt,
        structuredData: articleStructuredData({
          title: document.title,
          description,
          canonical,
          updatedAt,
          organisationName: site.organisation.name,
        }),
        query: null,
      }),
    )
    deps.publicSiteCache.rememberPage(site.siteSlug, path, page)
    return sendPage(request, reply, page)
  }

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    /**
     * `robots.txt`, naming a sitemap per published site (use case 29).
     *
     * At the root rather than under `/s`, because that is the only place a
     * crawler looks for it.
     */
    app.get('/robots.txt', { config: budget, schema: { hide: true } }, async (_request, reply) => {
      // The policy decides whether there are any sites at all, so an
      // organisation that has turned publishing off offers no sitemap either —
      // the rules still stand, because they are about what must never be
      // indexed rather than about what is published today.
      const settings = await deps.settings.readOrganisation()
      const published =
        settings.kind === 'settings' && settings.document.policies.publicPublishingAllowed
      const sites = published ? await deps.uow.repos.collections.listPublicSites() : []
      reply.type('text/plain; charset=utf-8')
      reply.header('cache-control', `public, max-age=0, s-maxage=${PAGE_SHARED_MAX_AGE_SECONDS}`)
      /* v8 ignore next -- `listPublicSites` only answers with rows that have a site. */
      const slugs = sites.flatMap((site) =>
        site.publicSite === null ? [] : [site.publicSite.siteSlug],
      )
      return renderRobots({ appUrl: deps.config.appUrl, siteSlugs: slugs })
    })

    /**
     * The stylesheet, addressed by the hash of the theme that produced it, and
     * therefore immutable: a theme change is a different address, so a reader
     * downloads this once and never revalidates it.
     *
     * The organisation's current theme is generated first, so a server that
     * has just restarted still serves the address its own pages are about to
     * link to; then the answer is a plain lookup by hash, which is what keeps
     * every sheet this process has ever generated servable — a reader holding
     * a page from before a theme change still gets the stylesheet that page
     * was written against.
     */
    app.get(
      '/s/_assets/:file',
      { config: budget, schema: { params: AssetParams, hide: true } },
      async (request, reply) => {
        const hash = ASSET_FILE.exec(request.params.file)?.[1]
        if (hash === undefined) throw notFound('No such asset')
        const settings = await deps.settings.readOrganisation()
        if (settings.kind === 'settings') deps.publicStylesheets.forTheme(settings.document.theme)
        const sheet = deps.publicStylesheets.byHash(hash)
        if (sheet === null) throw notFound('No such asset')

        reply.type('text/css; charset=utf-8')
        reply.header('cache-control', `public, max-age=${ASSET_MAX_AGE_SECONDS}, immutable`)
        reply.header('etag', `"${sheet.hash}"`)
        if (request.headers['if-none-match'] === `"${sheet.hash}"`) return reply.status(304).send()
        return sheet.css
      },
    )

    /** The site's home: its home document, or an index of what is on it. */
    app.get(
      '/s/:siteSlug',
      { config: budget, schema: { params: SiteParams, hide: true } },
      async (request, reply) => {
        const site = await siteAt(request.params.siteSlug)
        if (site === null) return noSitePage(request, reply)
        const home = site.home
        if (home !== null) {
          const path = site.pathById.get(home.id)
          /* v8 ignore next -- a home document on the site is always in the path table. */
          if (path === undefined) return notFoundPage(request, reply, site)
          return documentPage(request, reply, site, home, path)
        }

        const held = deps.publicSiteCache.page(site.siteSlug, HOME_PATH)
        if (held !== null) return sendPage(request, reply, held)
        const page = finished(
          renderPage({
            ...shellOf(site),
            currentPath: null,
            title: site.collection.name,
            description: null,
            canonical: absolute(publicSiteHref(site.siteSlug)),
            robots: null,
            outline: [],
            main: renderIndexMain({
              siteSlug: site.siteSlug,
              title: site.collection.name,
              navigation: site.navigation,
            }),
            updatedAt: null,
            structuredData: null,
            query: null,
          }),
        )
        deps.publicSiteCache.rememberPage(site.siteSlug, HOME_PATH, page)
        return sendPage(request, reply, page)
      },
    )

    /**
     * Search within the site, server-rendered (use case 28).
     *
     * The engine applies the permission filter inside its own query, with the
     * public principal and the site's workspace, so nothing a reader may not
     * see can come back. The site's own page table is then what confines the
     * results to this collection: it is already the authority on what is on
     * the site, and re-deriving the same answer as a query filter would be a
     * second place for "what is published here" to be decided.
     */
    app.get(
      '/s/:siteSlug/search',
      { config: budget, schema: { params: SiteParams, querystring: SearchQuery, hide: true } },
      async (request, reply) => {
        const site = await siteAt(request.params.siteSlug)
        if (site === null) return noSitePage(request, reply)
        const query = request.query.q?.trim() ?? ''
        const results = query === '' ? [] : await searchSite(deps, site, query)

        return sendPage(
          request,
          reply,
          finished(
            renderPage({
              ...shellOf(site),
              currentPath: null,
              // The query is *not* in the title. A search page is an address
              // anybody can choose the text of, and a title built from it
              // unfurls in a chat client as the organisation's own page saying
              // whatever the linker wrote. It is in the page, where the person
              // who typed it is looking, and nowhere a crawler quotes.
              title: 'Search',
              description: null,
              canonical: null,
              robots: NOT_A_PUBLISHED_DOCUMENT,
              outline: [],
              main: renderSearchMain({ siteSlug: site.siteSlug, query, results }),
              updatedAt: null,
              structuredData: null,
              query,
            }),
          ),
        )
      },
    )

    /**
     * The sitemap: every current address, and nothing else (use case 29).
     *
     * Never a redirect, never a draft, never a document this reader may not
     * see — it is generated from the same page table the navigation and the
     * pages themselves come from.
     */
    app.get(
      '/s/:siteSlug/sitemap.xml',
      { config: budget, schema: { params: SiteParams, hide: true } },
      async (request, reply) => {
        const site = await siteAt(request.params.siteSlug)
        if (site === null) return noSitePage(request, reply)
        sitemapHeaders(reply)

        // A site larger than one sitemap answers with an index of them, which
        // is what the protocol asks for and what stops one unauthenticated
        // request walking an unbounded number of documents.
        const pageCount = Math.ceil(site.pages.size / pageSize)
        if (pageCount > 1) {
          return renderSitemapIndex(
            Array.from({ length: pageCount }, (_unused, index) =>
              absolute(`${publicSiteHref(site.siteSlug)}/sitemap/${index + 1}`),
            ),
          )
        }
        return renderSitemap(await sitemapEntries(site, 1))
      },
    )

    /** One page of a large site's sitemap, named by the index above. */
    app.get(
      '/s/:siteSlug/sitemap/:page',
      { config: budget, schema: { params: SitemapPageParams, hide: true } },
      async (request, reply) => {
        const site = await siteAt(request.params.siteSlug)
        if (site === null) return noSitePage(request, reply)
        const page = Number(request.params.page)
        if (!Number.isInteger(page) || page < 1) throw notFound('No such sitemap')
        sitemapHeaders(reply)
        return renderSitemap(await sitemapEntries(site, page))
      },
    )

    /** A document page, an old address, or the site's own not-found page. */
    app.get(
      '/s/:siteSlug/*',
      { config: budget, schema: { params: PageParams, hide: true } },
      async (request, reply) => {
        const site = await siteAt(request.params.siteSlug)
        if (site === null) return noSitePage(request, reply)
        const path = request.params['*'].replace(/\/+$/u, '')
        const document = site.pages.get(path)
        if (document !== undefined) return documentPage(request, reply, site, document, path)

        const moved = await deps.uow.repos.publicRedirects.find(site.siteSlug, path)
        const to = moved === null ? undefined : site.pathById.get(moved.documentId)
        // A redirect only leads somewhere if the document it names is still on
        // the site: one that has been unpublished or carved out must answer as
        // missing, not as a hop to a page that would then refuse.
        if (to !== undefined && site.pages.has(to)) {
          // Revalidated like a page, not kept for ever. The redirect table is
          // mutable by design — a page renamed back reclaims its address — so
          // a `301` a browser cached permanently would keep sending a reader
          // off a live page with nothing the server could do about it.
          reply.header(
            'cache-control',
            `public, max-age=0, s-maxage=${PAGE_SHARED_MAX_AGE_SECONDS}`,
          )
          return reply.redirect(publicPageHref(site.siteSlug, to), 301)
        }
        return notFoundPage(request, reply, site)
      },
    )
  }
}

/** The headers a sitemap carries, wherever it is served from. */
function sitemapHeaders(reply: FastifyReply): void {
  reply.type('application/xml; charset=utf-8')
  reply.header('cache-control', `public, max-age=0, s-maxage=${PAGE_SHARED_MAX_AGE_SECONDS}`)
}

/** The newest of a set of publish stamps, or null when there are none. */
function newest(stamps: Iterable<Date>): Date | null {
  let latest: Date | null = null
  for (const stamp of stamps) {
    if (latest === null || stamp > latest) latest = stamp
  }
  return latest
}

/** The site's own matches, in rank order, each with the address it is published at. */
async function searchSite(
  deps: AppDependencies,
  site: PublicSite,
  query: string,
): Promise<readonly SearchResultView[]> {
  const workspaceId = site.collection.workspaceId as WorkspaceId
  // The same rule `/api/search` refuses with: a query naming only exclusions
  // is an enumeration of the whole site rather than a search (ADR-010). Here
  // it simply finds nothing — a stranger typing into a box is owed a page,
  // not an error.
  if (unsearchable(query) !== null) return []

  const results = await deps.search.search({
    queryText: query,
    filter: visibilityFilter([workspaceId], [PUBLIC_PRINCIPAL]),
    currentWorkspaceId: workspaceId,
    limit: PUBLIC_SEARCH_LIMIT,
  })
  /* v8 ignore next -- `unsearchable` parsed this very text a moment ago. */
  if (!results.ok) return []

  return results.value.current.flatMap((hit) => {
    const path = site.pathById.get(hit.documentId)
    return path === undefined || !site.pages.has(path)
      ? []
      : [{ title: hit.title, path, snippet: hit.snippet }]
  })
}

/**
 * How many matches a public search asks the engine for.
 *
 * More than it shows, because the engine answers for the whole workspace and
 * the site is one collection of it: asking for exactly a page's worth would
 * hand back a short page whenever the workspace has other public collections.
 */
export const PUBLIC_SEARCH_LIMIT = 50
