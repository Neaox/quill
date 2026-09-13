# ADR-023: Public publishing and server rendering

**Status:** Accepted (public publishing implemented 13 September 2026; share links ship separately)
**Date:** 2026-09-12
**Related:** quill-plan.md section 14; ADR-012, ADR-013; decisions D13, D14

## Context

Developer teams publish documentation to the world. Public pages must be crawlable, fast, and consistent with the authenticated reading experience. Share links need the same anonymous access path with a token.

## Decision

- A workspace or collection can be **published**: slug or path, branding, navigation, and a Viewer grant to the **public** principal.
- Anonymous requests to public routes receive **server-rendered HTML** produced from the same React reading components used in the application, cached by content hash and invalidated by publish events. Sitemaps, canonical URLs, robots rules, and Open Graph metadata are generated.
- Public search is scoped to public content and rate limited.
- **Share links** are tokens mapped to a grant with scope, role, expiry, optional password, revocation, creator, and audit. Workspace policy controls creation and maximum role.
- The authenticated application remains a single-page app.
- Open: whether server rendering is a Fastify-hosted React render or TanStack Start. R8 decides. The reading components are shared either way.

## Implemented

**Public publishing — 13 September 2026 (M3).** Everything above except share
links (which shipped on their own) and custom domains is built, server side:
`docs/architecture/public-site.md` is the contract, the routes are
`apps/server/src/routes/public-site.ts`, and the templates are
`apps/server/src/public-site`. A collection carries
`public: { enabled, siteSlug, homeDocumentId }` and a
`(public, collection, viewer, allow)` grant, so the existing resolver answers
visibility and one document is carved back out with a deny at document scope
without any of the publishing path knowing. Pages are at
`/s/<site>/<collection>/<title>` with `public_redirects` and a `301` behind
renames and moves (ADR-035), a sitemap of current paths only, `robots.txt`,
canonical links, Open Graph tags, `Article` structured data, ETag and `304`,
an immutable-by-hash stylesheet, per-address rate limits, and public search
through the search core with the public principal.

**Three things this ADR left open are settled here, and each is recorded
because a later reader will otherwise assume the ADR said so.**

- **R8's question is answered by neither of its options.** The ADR asked
  whether server rendering should be a Fastify-hosted React render or TanStack
  Start; it is neither, and no React runs on the server. The reason is
  ADR-031: by the time a public page is served, the document's body is
  *already HTML* in the render cache, produced by `packages/markdown` — the
  same bytes the reading view mounts into the DOM. What a React render would
  add is the page *around* the body, which is a header, a navigation tree, a
  table of contents and a footer: four small templates. Standing up a second
  renderer, a second bundle and a hydration story to produce them would buy
  nothing the templates do not, and would cost the public site its best
  property, that it ships no JavaScript at all. What the ADR was protecting by
  saying "the reading components are shared either way" *is* shared: the
  renderer's output and the design system's CSS, so a block is the same width
  and the same type on the web as it is in the app (AGENTS.md rule 16). Only
  the small amount of chrome is written twice, once in React and once as a
  template, and `public-site.test.ts` in `packages/ui` is what keeps the two
  stylesheets from drifting.
- **"Cached by content hash and invalidated by publish events" is half right.**
  Nothing is invalidated. The body is content-addressed and a publish produces
  a new key (ADR-031), and the page's `ETag` is a hash of the finished page,
  so a publish, a rename, a theme change and a settings change all produce a
  different page without anything having to be swept.
- **The policy takes sites down.** `policies.publicPublishingAllowed` was
  written as a control on *creating* a public site (ADR-034). It is enforced on
  every read as well: with it off, a site that is already up answers as if it
  were not there. The alternative — a policy that only hides a switch — would
  mean an organisation could not stop publishing without visiting every
  collection.

**Still to come on this ADR:** the web half (a publish switch in a
collection's settings, an access screen for the document-scope deny), the
"Open in the app" affordance — which cannot be decided on the server, because
the page is cached for everyone and varying it by reader would give up the
shared cache — and custom domains.

## Alternatives considered

- **Static site generation at publish time.** Attractive because publish is the only write, but complicates share links and permission changes. R8 evaluates it as a cache strategy rather than the architecture.
- **Client-rendered public pages.** Rejected: not reliably crawlable.

## Consequences

- The public principal and grants (ADR-012) must exist before M3.
- Custom domains are an open question (plan, Part VII).
