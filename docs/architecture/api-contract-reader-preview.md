# API contract: the reader preview

A member previews a document as a reader of the public site will see it. The route is a **page, not an endpoint**: it answers with HTML rendered by the public site's own templates (`apps/server/src/public-site`), so, like the public site, it is not in the OpenAPI description or the generated client (`docs/architecture/public-site.md`).

| Method and path | Purpose | Response |
|---|---|---|
| `GET /preview/d/:documentRef` | The document in the public site's chrome | `200 text/html`; `303` to sign-in without a session; `404 text/html` when there is nothing this member may preview |

`documentRef` is anything the document routes accept (ADR-035): the readable reference (`the-sync-map-j9t064k4d7`), the short key alone, or the UUID. The words are advisory and never consulted.

## What it renders

- **The same page a reader gets**: the header and its lockup, the organisation's configured links, the colour-scheme switch, the stylesheet generated from the organisation's theme, the reading grid and typography, "On this page", the eyebrow naming the collection and the footer. One template (`templates/page.ts`) renders both surfaces, so a preview cannot drift from what it previews.
- **The navigation the public site would build**, one section per collection of the document's workspace, each built by `publicNavigationOf` — published revisions only, nested and ordered as on the site — over what *this member* may read, with the document's own collection open. Entries link to other previews.
- **The latest published revision**, from the render cache (ADR-031). A document never published shows the chrome around a note saying so. Drafts are not previewed.
- **Whether a page is a preview** in a slim pill fixed to the bottom of the window — `Preview`, then *Not on the public web* or *Live on the web · View the live page* (asked of `loadPublicSite`, the one authority on what is on a site) — and a close control that is a link back to the document in the application. It floats rather than pushing the header down, so the layout above it is exactly a reader's.
- **No search box**: the site's search answers for what is published, and a preview of what may not be has nothing it could honestly search.

## Authorisation

Through the one resolver, as every document route (ADR-012): the route checks `view` on the document with the request's authorizer (`requireDocumentAccess`) and then calls the `loadReaderPreview` use case, which decides what else the navigation may list by the same materialise-and-combine pass the signed-in tree uses. Routes never read storage.

- **No session**: `303 See Other` to `/sign-in?redirect=/preview/d/<documentRef>`, so the member comes back here after signing in. The session is read with `optionalSession` for exactly this; a JSON `401` would be the API showing through an HTML surface.
- **A document that is not there, and one the member may not read, get the same `404` page**, with nothing taken from the document — the share-link rule (ADR-011): a member must not learn that a document they are kept out of exists.
- A tenancy tree that contradicts itself is a `500`, as on every document route. Settings that cannot be read are a `409 settings_unreadable`: the theme is part of what is previewed, and an unreadable settings file is never folded into the defaults.

## Headers

- `Cache-Control: private, no-store` on every answer, the redirect and the refusal included: the page carries whatever this member may read, and a shared cache must never hand it to anybody else. No `ETag`.
- `X-Robots-Tag: noindex, nofollow`, and the same in a `<meta name="robots">`; no canonical link and no structured data. `robots.txt` also disallows `/preview/`.
- The platform's strict CSP (ADR-011), unchanged: the page runs no inline script, and the scripts it loads are the public site's same-origin, hash-addressed colour-scheme file (`public-site/scheme-script.ts`) and reader module (`public-site/reader-script.ts`: syntax highlighting and the diagram lightbox).

## In the application

`PreviewLink` (`apps/web/src/features/documents/preview-link.tsx`) is the entry point: a link styled as a small secondary button that opens the preview in a new tab. In development the Vite server proxies `/preview/` and `/s/` to the API server (`apps/web/vite.config.ts`), as it already did `/api`.
