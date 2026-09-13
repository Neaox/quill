# The public site

How a published collection is served to the world (ADR-023, ADR-035; plan section 14; use cases 27–30). The server implements this; it is **not** part of the JSON API, so none of the addresses below appear in the OpenAPI description or in the generated client. A page is not an endpoint and a crawler is not a client (`docs/product/surfaces.md`).

Two JSON routes *are* part of the API, because they are changes to a collection rather than pages: publishing one and taking it down. They are documented at the end.

## Addresses

| Address | What it answers with |
|---|---|
| `GET /s/<site>` | The site's home: its home document, or an index of what is on it |
| `GET /s/<site>/<collection>/<title>` | One document page |
| `GET /s/<site>/search?q=` | The site's own search results, rendered server-side |
| `GET /s/<site>/sitemap.xml` | Every current address, with a `lastmod`; an index of sitemaps once a site outgrows one |
| `GET /s/<site>/sitemap/<n>` | One page of a large site's sitemap |
| `GET /s/_assets/theme-<hash>.css` | The one stylesheet a page loads, immutable |
| `GET /robots.txt` | The rules, and one `Sitemap:` line per published site |
| `GET /api/attachments/<id>` | The pictures a published page is made of — the API's own route, which takes an optional session |

`<site>` is the collection's `siteSlug`, unique across the instance. `<collection>/<title>` is the page's path within the site: the collection's own slug, then the document's title slugified by `slugify` (ADR-035). Two documents whose titles slugify the same are separated by appending the later one's short key; the earlier one keeps the plain words, and the table is computed over *every* document in the collection, so carving one page out of the site never moves another page's address.

`_assets` can never collide with a site: `slugify` emits only letters, digits and hyphens, so no site slug contains an underscore.

## What a page is

A page is server-rendered HTML with **no application behind it**: no bundle, no hydration, no JavaScript at all beyond an optional `<script type="application/ld+json">` carrying `Article` structured data, which is nonce'd like any other inline script.

- **Landmarks**: a skip link, a `header`, a labelled `nav` for the site's sections, a `main` holding the page in an `article` on the reading grid, a second labelled `nav` for the contents, and a `footer` with an absolute `<time datetime>`.
- **The body** comes out of the render cache (ADR-031) — the same bytes the reading view mounts — and the `<article>` the renderer wraps it in is replaced by the reading grid, so breakout blocks still span it (ADR-027).
- **For a crawler** (use case 29): a canonical link, a description taken from the document's first paragraph, Open Graph tags, `Link: rel=preload` for the stylesheet, and a sitemap. **Never `noindex` on a published document** — that belongs to share links, which are a different surface. The search results and the not-found page *do* carry `noindex,follow`, because neither is a published document and both are addresses whose text the person following the link chose; the query is in the page, never in `<title>` or `og:title`.
- **Pictures.** The Markdown sanitiser admits `/api/attachments/<id>` as an image source, so that is the URL every picture in every document carries. The attachment read route therefore takes an **optional** session and lets the resolver decide: an anonymous request arrives holding the public principal, so an attachment is served anonymously exactly when its own document is publicly visible, and a document carved out with a deny takes its pictures off the web with it. A refusal to a caller with no session is the same `404` an unknown id gets. `robots.txt` allows `/api/attachments/` inside an otherwise disallowed API.
- **Exactly one `<h1>`.** Almost every document provides it, because the title *is* its first heading (ADR-005); a body that opens at `##` gets the document's title rendered as the page's `<h1>` instead.
- **Templates**: one per concept, in `apps/server/src/public-site/templates` — the page, the navigation tree, the table of contents, the footer (AGENTS.md rule 16). The middles of the four pages (a document, an index, search results, not found) are in `public-site/pages.ts`. Every one of them is built with the `html` tag in `public-site/html.ts`, which escapes anything interpolated into it unless it is marked as HTML: the public site is the one surface where an escaping mistake is a stored cross-site script on a page nobody has to sign in to reach.

## What is never on one

- **A draft.** `loadPublicSite` keeps documents with no head revision out of the site entirely, so a draft is absent from the navigation, the sitemap and every address.
- **A document this reader has no grant for.** The reader is the public principal and nothing else, resolved by the same materialise-and-combine pass the signed-in navigation tree uses (ADR-012). A document carved out with a deny to `public` at document scope is absent from the navigation, from the sitemap, and from its own address — and still readable by the people who maintain it (use case 30).
- **A lock, a comment, a presence indicator, or any of the application shell** (`docs/product/surfaces.md`).
- **A session.** These routes read no cookie: no `preHandler`, no check. A public page is the same page for everyone who asks for it, which is what lets it be cached for everyone who asks for it.

## Caching

- **The body** is the render cache's entry, keyed by what it was rendered from and the render version (ADR-031).
- **The page** carries an `ETag` that is a hash of the finished page. Nothing on the page varies per response — there is no nonce on it, because the one `<script>` is `application/ld+json`, a data block rather than code — so two readers asking for the same page get the same bytes and the same tag. `If-None-Match` answers `304`. `Cache-Control: public, max-age=0, s-maxage=60`, so a CDN may hold it briefly and a browser always asks.
- **The resolved site and the finished page are kept in this process** for a short time (`public-site/cache.ts`). Without it, every page view read every document row in the collection, materialised effective permissions over all of them, and read the published Markdown out of the content store — per request, from no account at all, on a budget sized for a crawler. The cache is emptied by the outbox events the server already consumes (`DocumentPublished`, `DocumentRenamed`, `DocumentMoved`), by publishing or unpublishing a collection, and by saving the organisation's settings; anything else — a grant written by hand, a document deleted — is caught by a time to live that is never longer than the `s-maxage` the page already carries, so the cache cannot make a page staler than a shared cache in front of the server is already allowed to make it. Both maps are bounded by size.
- **A `301` from the redirect table revalidates** like a page rather than being kept for ever: the table is mutable by design — a page renamed back reclaims its address — so a permanently cached redirect would keep sending a reader off a live page with nothing the server could do about it.
- **The stylesheet** is addressed by the hash of the theme document that produced it and served `public, max-age=31536000, immutable`. A theme change is a different address rather than a cache to bust, and every sheet this process has generated stays servable, so a reader holding an older page still gets the stylesheet it was written against.

## The stylesheet

One file, four things concatenated in the order they cascade:

1. the organisation's **generated theme** — `--palette-*`, `--token-*`, `--font-*`, `--radius-*`, `--layout-*` — from `@quill/theme`, with light at the root and dark under `prefers-color-scheme` (ADR-028). There is no scheme toggle and therefore no script;
2. the **syntax token colours**, from `@quill/highlight`'s contract (ADR-030);
3. `packages/ui/src/styles/public-site.css`: the semantic layer as plain CSS, plus the site's own furniture;
4. `layout.css` and `prose.css`, verbatim from `packages/ui`, which is what makes a block the same width and the same type on the web as it is in the app.

(3) exists because `tokens.css` declares the semantic layer inside Tailwind's `@theme`, which only a Tailwind build can resolve, and the public site has no build. The two files are not allowed to drift: `packages/ui/src/styles/public-site.test.ts` reads both and fails when a value differs, the same way `generated-css.test.ts` holds the generated palettes honest. `@quill/server` depends on `@quill/ui` for exactly this — it imports that one module and the CSS beside it, never a component.

## Addresses that have moved

A public URL is built from the current title, so a rename changes it, and a move between collections changes the collection segment. ADR-035 accepts that cost here and nowhere else, on one condition: the old address keeps working.

- `public_redirects` holds `(site, old path) → document id`, written by two outbox consumers on `DocumentRenamed` and `DocumentMoved`.
- The route answers an old address with `301` to wherever the document lives **now**, recomputed from the document — the table never decides an address, so it cannot become a second, stale opinion about where a page is.
- A redirect that leads to a document no longer on the site answers as missing, not as a hop to a page that would then refuse.
- **The sitemap lists current paths only**, ever.
- **Republishing at a different address takes the old address's redirects with it**, so they cannot be inherited by whichever collection claims that slug next.
- A collection that has ever been published keeps writing redirects even while its site is switched off, so a site that comes back comes back with its history of addresses intact.

## Search

`GET /s/<site>/search?q=` runs the query through the search core with the public principal and the site's workspace, so the permission filter is applied inside the engine's own SQL (ADR-010, ADR-012) and nothing a reader may not see can come back. The site's page table then confines the results to this collection: it is already the authority on what is on the site, and re-deriving the same answer as a query filter would be a second place for "what is published here" to be decided. A query that names only exclusions is not a search — it is an enumeration — and finds nothing; the rule is `unsearchable` in `routes/search-query.ts`, shared with `GET /api/search`, which refuses it with `422` instead.

## Policy, and taking a site down

Publishing is governed by `policies.publicPublishingAllowed` in the organisation's settings (ADR-034). With it off, publishing is refused **and every site already up answers as if it were not there** — turning the policy off takes the sites down rather than merely hiding the control that made them. Settings this release cannot read are treated the same way: no policy can be applied, so nothing is published. Stylesheets already generated keep serving, so a page a reader is holding does not lose its styling as well.

Unpublishing is never refused by policy: an organisation that has turned publishing off must still be able to take down what is already up. It switches the site off and **keeps the address**, so putting it back up answers where it always did and nobody else can claim the slug meanwhile.

## Abuse resistance

Every route here — including the attachment read route, which now answers strangers — counts against one per-address budget (`PUBLIC_SITE_RATE_LIMIT_MAX`, 600 a minute by default). It is separate from, and far larger than, the authentication budget: one page view is a page plus a stylesheet, and a whole office — or a whole crawler fleet — arrives from one address.

The response headers are the platform's (ADR-011): a strict nonce-based CSP with no `unsafe-inline` and no `unsafe-eval`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

## The JSON half: publishing a collection

| Method and path | Purpose | Response |
|---|---|---|
| `POST /api/collections/:id/public` | Publish, or republish at a new address | `200 Collection`; `403 public_publishing_disabled`; `409 public_site_slug_taken`; `409 settings_unreadable`; `422 public_home_not_in_collection` |
| `DELETE /api/collections/:id/public` | Take the site down, keeping its address | `200 Collection`; `409 public_site_not_published` |

Both need **`manage` on the collection** — whoever may grant access there may open the door widest of all — and a verified email address, like every other write (ADR-011).

```ts
// On every Collection in the API:
public: {
  enabled: boolean
  siteSlug: string
  homeDocumentId: string | null   // null shows an index of the collection
  url: string                     // <APP_URL>/s/<siteSlug>, pre-assembled
} | null                          // null until it has ever been published
```

**Publish body**: `{ siteSlug?, homeDocumentId? }`. An omitted `siteSlug` keeps the address the site already had, then falls back to the collection's own slug; whatever is given is slugified. An omitted `homeDocumentId` leaves the home as it was — a republish is not a reset — and an explicit `null` clears it back to the index.

Publishing also writes the permission: a `(public, collection, viewer, allow)` grant, through the same `createGrant` command every other grant goes through, so the domain's rules are checked here too. Unpublishing removes it. Nothing about public reading is a second permission system: a public collection *is* a viewer grant to the public principal, which is also why one document can be carved back out with a deny at document scope without any of this knowing.

Both are audited (`collection.published`, `collection.unpublished`), and both write the row, the grant and the audit entry **in one transaction**: the address and the permission are the same fact stated twice, and an unpublish that switched a site off and then failed to remove the grant would leave a viewer grant to `public` standing at a collection whose settings screen says it is not published.

Moving a document between collections is audited too (`document.moved`), naming both collections and whether either is published, because public reading *is* a collection-scope grant: moving a private document into a published collection is a publication to the anonymous web.

A home document that is not in the collection, or that has never been published, is refused with its own code rather than silently falling back to the index — a setting that is quietly ignored is one somebody debugs twice.

## Layering

The plain CSS is `@quill/design-css`, a package with **no dependencies at all**: `@quill/ui` imports it into the application's stylesheet and `@quill/server` reads it as text. The server does not depend on `@quill/ui` — a server that installed the component library to read three files would pull React, Radix, Sonner and nine font packages into every production tree — and `.dependency-cruiser.cjs`'s `server-does-not-import-ui` rule keeps that decided rather than remembered.

## Not yet

- **The web half**: a publish switch in a collection's settings, and an access screen that writes the document-scope deny. The server is complete without them; both call the routes above.
- **The "Open in the app" affordance** (`docs/product/surfaces.md`, use case 28). It cannot be decided on the server: the page is cached for everyone, and varying it by who is reading would give up the shared cache. It arrives with the web half.
- **Custom domains**, which ADR-023 leaves open.
- **A site spanning more than one collection.** The address already has room for it — `/s/<site>/<collection>/<title>` — and nothing above the path table assumes one.
- **A language other than English.** `<html lang>` is `en`, because taking it from the organisation means a new settings field and therefore a version bump of the settings document for every instance (ADR-034). It belongs with the theme-onboarding work, which is going to touch that document anyway.
- **The materialised effective-permission table** (plan §15). The cache above bounds what an anonymous burst costs; the table is what removes the per-request walk altogether, and it is the right long-term answer for this surface.
