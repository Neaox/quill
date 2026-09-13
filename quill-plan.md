# Quill

## Open Source Documentation Platform
### Product, Architecture and Delivery Plan

Revision 2 — 12 September 2026. Supersedes the review draft, kept for the record at `docs/archive/quill-plan-review.md`.

---

## How to read this document

- **Part I — Product.** What Quill is, who it is for first, and what it will not be.
- **Part II — Decision register.** Decisions already taken, with rationale. These are firm unless an ADR reverses them.
- **Part III — Architecture.** The system as it will be built, including the parts the review draft left out: backend, storage, tenancy, drafts, comments, sharing, public publishing, operations.
- **Part IV — Engineering standards.** Condensed from the review draft.
- **Part V — Research phase.** Time-boxed investigations that still have to run, and what each must decide.
- **Part VI — Delivery plan.** Milestones in build order, the MVP definition, and the list of things built early specifically to avoid rewrites.
- **Part VII — ADR index and open questions.**
- **Appendix — Changes from the review draft.**

## Delivery status

Kept current at every milestone boundary and at every review round. The dates are when the entry was last verified against the code, not when the work was planned.

| Milestone | Status (13 September 2026) |
| --- | --- |
| M0 — Research and bootstrap | **Done.** Research spikes R3, R4, R5, R13 decided ADRs 003, 014, 021, 013; the repository constitution, quality gate, and CI exist. |
| M1 — Foundation | **Done, under review hardening.** Tenancy, principals, grants and the resolver (permission semantics amended 12 Sep, ADR-012); email/password, magic links, sessions, rate limits, audit; content store with filesystem and memory backends, publish, history, diff, restore; markdown pipeline with front matter, directives, sanitiser, renderer; Postgres schema, migrations, outbox, job runner; OpenAPI and generated client; design tokens and primitives. Four independent reviews (domain/application, content store, markdown/highlight, server) found defects; fix passes are landing before the initial commit. |
| M2 — Write and read | **Mostly done.** Editor with the mdast converter, code blocks, tables, images by URL, links, callouts, slash commands; drafts, autosave, locking, recovery; reading view with outline, anchors, light and dark, responsive, breakout widths; history, compare and restore in the UI; templates with questions; toast primitive; full-screen presentation mode (sections as steps at projector scale, progress bar, section rail, fading presenter bar, keyboard navigation, a "go to" overlay, presenter notes from `:::notes`, the step in the URL, and the Fullscreen API with a windowed fallback); **the organise flows, end to end through the interface**: a file-based route tree whose workspace shell is a layout route rendered once and never unmounted, units and workspaces created, renamed and deleted from `/admin/organisation` and from the home page's set-up card, collections created from the sidebar and the workspace's empty state and renamed and deleted from their own menus, documents created anywhere a person is working and nested, renamed, moved and deleted, the signed-in home's Continue and Recently updated sections, human-readable document addresses (ADR-035), and `e2e/organise.spec.ts` proving all of it on every browser profile. **The independent review of the web app is done and closed** (`docs/architecture/review-2026-09-13-web.md`, closure in `review-2026-09-13-web-closure.md`): two critical, five high, eleven medium and eleven low findings, all closed but one — the theme identity is still never applied, because no M2 route carries a theme or a layout, which ADR-028's amendment schedules with workspace settings in M3. **The bundle is inside its budget:** the reading route is 208.6 KB gzipped against 250 KB, down from 279.9 (the attachments panel is reached from the document header, so it is a reading-route feature and its 2.2 KB is counted here), and `pnpm check:bundle` is now the last step of `pnpm check` and blocks in CI. **All four browser profiles are green:** 84 end-to-end journeys on Chromium, Firefox, WebKit and mobile Safari, the `organise` journey among them. **Attachments are done:** a blob store behind the `BlobStore` port with filesystem and S3-compatible adapters (`BLOB_STORE=filesystem|s3`, MinIO locally), an `attachments` table, upload with server-side content sniffing, a size cap counted as the bytes arrive, an allowlist of images plus PDF with SVG refused and the reason given, metadata stripped from every uploaded picture at the container level before the hash is taken (ADR-011, amended 13 September), serving with `nosniff`, a sandboxing CSP, RFC 6266 filenames and revalidated caching, a delete refused while a published document in the same workspace still shows the file, an editor image dialog that uploads from a file picker, a drag onto the document, or a paste, and an attachments panel on the document’s own menu. **Not yet, in priority order:** presence beyond the lock holder, and the editor accessibility review on Firefox, WebKit, and mobile (tags, owners, status and review editing now live in the editor's properties strip, which replaced the raw front matter). Presentation mode's "note for later" (quill-plan §14) waits on comments in M4, and is a disabled control with its reason until then. **One defect is open against the server, reproduced through the API alone:** a signed-up member with no grant is refused a workspace with `403`, which `e2e/auth.spec.ts` still assumes is not checked. (The rename defect behind use case 8 — a publish rewriting the title from the draft's front matter, which the rename had not touched — was fixed on 13 September: a rename writes the title into the draft as well as the row, and the next publish carries it, ADR-015.) |
| M3 — Find, share, publish | **Wave two landed (13 Sep): search, share links, single sign-on with the secrets-store migration, the settings screens and the server-rendered public site are all merged (#10, #14, #13, #12, #17), each after an Opus review closed by its author and a green gate. What remains of M3 is listed at the end of this row.** **Share links** (`docs/architecture/api-contract-share-links.md`). `ShareLink` and its scope rules are in the domain, the authorizer resolves a presented token into the share-link principal with its scope — so the M2 `TODO(M3)` that dropped share-link principals is gone — and the use cases create (256-bit token, SHA-256 stored, raw token returned once), list, revoke and resolve. On the wire: `POST`/`GET /api/documents/:id/share-links` and `DELETE /api/share-links/:id` behind `manage`, and the anonymous reading path `GET /api/share/:token` and `GET /api/share/:token/documents/:id/rendered` — no drafts, no lock, nothing beyond the link's scope (`docs/product/surfaces.md`), `noindex`, rate limited per address, and one identical `404` for unknown, expired, revoked, out-of-scope and unpublished alike. Every use is audited — the link, the document read, and the source address as a digest — in the same transaction as the stamp the link list reads. The token is redacted from every log line and from the not-found response that echoes a URL, and never reaches an audit row, which names the link. Policy is `SHARE_LINKS=on\|off` until the settings store lands. **The web half is built too, so share links are end to end** (13 Sep): a Share action in the document header, offered to whoever holds `manage`, opens a dialog that lists every link on the document with what it opens, its term, whether it has been used and whether it has been revoked; creates one scoped to the document or its subtree, expiring in 7 days, in 30 days, on a chosen date, or never, with view as the only role this release carries; shows the address exactly once with a copy control and the reason it is only shown once; and revokes one behind a confirmation. A `403 share_links_disabled` replaces the form with the reason, in place, and leaves the list standing. The reader's page is the root-level `/share/$token`, outside `_authenticated` and outside the workspace shell: the site's name, the document mounted through the same `DocumentBody` the application reads with, its contents, and one line saying the reader was given a link and when it runs out — no session, no cookie (`credentials: 'omit'` on both reading requests), `noindex` through the route's `head()`, and one identical "This link is not available" for every refusal. A subtree link also lists what it opens and reads each document at `/share/$token/d/<title-slug>-<key>` through its own route. Nothing on the reader's page preloads: everywhere else the router reads a route ahead of the click, and here a fetch *is* an audited use of the link, so running an eye down a subtree's titles would spend the anonymous budget and lock the reader out of a link that is good. A refusal and a failure are told apart: every answer the server gives is the one indistinguishable "This link is not available", and a connection that never arrived says so instead, with no way into the application either way. Proved by 43 component tests over the real router and the real cache, and by `e2e/share.spec.ts` on **all four browser profiles**: one journey creates a link through the interface, reads it in a fresh browser context with no cookies, revokes it and finds it closed; the other opens a subtree link, moves to a child document through the navigation, and finds the chrome unmoved and nothing of the signed-in world on the page. The share page is its own chunk (153.8 KB gzipped) and the reading route is still inside its budget (214.5 KB against 250). **Not yet:** a link's optional password (with comment and edit roles, M7). **Search: the server half is done.** The PostgreSQL adapter behind `SearchIndex` is built and exercised against a real database — a `document_search` table with the weighted `tsvector` columns of ADR-010 (title A, headings B, body C), a GIN index, `pg_trgm` for typo tolerance where the extension can be installed, permission filtering applied *inside* the SQL through the same materialise-and-combine the navigation tree uses (ADR-012), workspace-affinity ranking and grouping (§15), snippets as offsets from the core's `buildSnippet`, and keyset paging. Indexing runs from the `DocumentPublished` and `DocumentRenamed` outbox events, deletion falls out of a cascading foreign key, and `pnpm --filter @quill/server reindex` rebuilds the index (and optionally cached bodies) from the content store (ADR-034). `GET /api/search` is in the OpenAPI description, the generated client, and `docs/architecture/api-contract-m2.md`. The two `SearchIndex` declarations are now one port, declared in `@quill/application` and re-exported by `@quill/search`. Measured against the §31 budget on a corpus of 50,000 documents across 20 workspaces, two of them readable (`pnpm --filter @quill/server bench:search`, median of five, page of twenty): `database failover runbook` 137–180 ms, a single term 90–97 ms, a phrase 83–102 ms, a misspelled query 119–157 ms, a bare `tag:` filter 50–76 ms — against 300 ms. **Still to do in M3's search:** the materialised effective-permission table and the events it needs (see §15), which replaces the per-request permission walk with a join. **The settings store is built, server side** (ADR-034, `docs/architecture/api-contract-settings.md`). An organisation's settings — name, logo, theme, the default layout, the public site's navigation, and the policies (share links, public publishing, and how strictly the theme doctor reports) — and a per-workspace layout override are versioned YAML files in a system workspace of the content store, written through the publish path with a compare-and-swap over the file's own bytes, so every change has an author, a change note and a history, and a concurrent write is refused rather than merged. A file this release cannot read is reported with its revision to an instance administrator, who repairs it through the API. Secrets entered in the product are envelope-encrypted rows under an instance master key from a `KeyProvider` (environment or key file), referenced from settings files by name only, with `setSecret`/`getSecret`/`listSecretNames`/ `rotateMasterKey` behind `pnpm --filter @quill/server secrets:rotate`, and an API that never answers with a value; both layers of each envelope are bound to where they sit, so a row cannot be moved to another name and read as that secret. `GET/PUT /api/settings/organisation`, `GET/PUT /api/workspaces/:id/settings` and the secrets routes are in the OpenAPI description and the generated client. This is the foundation theme onboarding, per-workspace layout, public navigation and the share-link policy all sit on — `SHARE_LINKS=on|off` moves to `policies.shareLinksAllowed` when the share-link path reads it. **OIDC sign-in is built** (13 Sep): one OpenID Connect implementation with providers as data presets — Entra ID with the tenant pinned, Google Workspace with the hosted domain checked, Cognito, Auth0, generic — Authorization Code with PKCE only, `state` and `nonce` bound to a `__Host-` cookie, discovery and JWKS through the SSRF-safe outbound client with a TTL and a rate-limited rotation re-read, id tokens verified with `node:crypto` against an allowlist that a `crit` header or a weak key cannot get past, identities keyed by `(issuer, subject)` in a new `identities` table, linking only into an account that has already verified that address for itself — and only where the provider allows linking at all — just-in-time provisioning behind a per-provider flag, sessions issued and rotated through the existing service with a link revoking every other session that account holds, enumeration-safe failures, a flat per-address budget of its own, and every outcome audited without tokens; the sign-in page offers one button per configured provider. Proved end to end by a real OpenID Connect provider running in-process (discovery, JWKS, token endpoint, real RS256 keys). **Search's web half is built** (13 Sep): a command-palette search dialog opens from the top bar's search field and from Ctrl+K or Cmd+K anywhere signed in — a combobox over a grouped listbox (`CommandPalette`, new in `@quill/ui`, with a specimen in the design showcase), debounced typeahead, results grouped "In this workspace" then per workspace under "Elsewhere", snippets rendered as `<mark>` from the API's offsets and never from server HTML, the breadcrumb under each hit, arrow-key navigation with focus never leaving the field, a result named by its title alone with the snippet and trail as its description, a polite live region announcing how many results arrived and how many workspaces they crossed, `422 invalid_query` shown inline at the character it was refused at — of the *answered* query, not of what is still being typed — a field that stays busy through the debounce as well as the request, axe checks over the primitive and over both composed surfaces, and a phone layout; and a full results page at `/w/<workspace>/search?q=` with the same grouping, infinite "Show more" paging through `nextCursor`, and the query as a validated search param (ADR-013). Both read one `lib/api/search.ts`, and the palette is a lazily loaded chunk — 2.7 KB gzipped — so the reading route is unchanged by it. `e2e/search.spec.ts` covers use case 20 end to end — ten journeys, **green on all four browser profiles** (Chromium, Firefox, WebKit and mobile Safari; 40 passed). Signing out now empties the query cache rather than forgetting only `me`, so one account's search results cannot outlive its session in a shared tab. **The settings screens are built, web side** (13 Sep, use cases 35 and 36). `/admin/settings` is a layout route with a left navigation, gated once at the top: **Organisation** (name, the logo as a hash reference with no inert upload until attachments land, public navigation with add, reorder, remove and the server's own href whitelist, and the three policies), **Theme** (ADR-028's layer-2 levers — accent, tone, reading face, radius, density, per-collection colours — over a live preview of a real document in light and dark, painted with palettes `@quill/theme` generates in the browser, with the doctor's report beside the form, an AA failure put in front of `policies.contrastEnforcement`, and fork/reset-to-built-in semantics), **Layout** (the bounded variant set as radio groups with illustrations, the organisation's default and the lock) and **Secrets** (write-only values, delete behind a confirmation, the rotation command named rather than offered, and a read-only readout of the configured sign-in providers). Every write states the revision it read at, a `409` becomes a conflict state showing the other person's values, and a settings file this release cannot read offers the administrator the repair `PUT` at the revision the server reported. A workspace's own settings are `/w/:slug/settings`, reached from the workspace overflow, with the lock shown and refused rather than hidden. `@quill/theme`'s generator, rules and doctor reach only this route's chunk: the reading route is 216.9 KB gzipped against its 250 KB budget, and the theme editor is a chunk of its own at 215.6 KB. `e2e/settings.spec.ts` is written and runs at merge, on **one** browser profile rather than four: an instance has exactly one organisation settings document, so four profiles writing it at once are four administrators racing, and three of them are correctly refused by the compare-and-swap — which is proved where it belongs, in `settings.integration.test.ts` and in the screens' own conflict tests. **Public publishing is built, server side** (ADR-023, `docs/architecture/public-site.md`). A collection carries `public: { enabled, siteSlug, homeDocumentId }` on its row and a `(public, collection, viewer, allow)` grant, written together by `publishCollection` through `POST /api/collections/:id/public` behind `manage` on the collection and `policies.publicPublishingAllowed` — so the existing resolver answers visibility, and one document is taken off the web with a deny at document scope without any of the publishing path knowing (use case 30). `DELETE` takes a site down and keeps its address. The site itself is server-rendered HTML with no application behind it and no JavaScript at all: a home, a page per document at `/s/<site>/<collection>/<title>`, its own search through the search core with the public principal, a sitemap of current paths only, and `robots.txt` — four templates (page, navigation, contents, footer) over the render cache's own body (ADR-031) and the design system's own layout grid and reading typography, styled by the organisation's generated theme with light and dark following `prefers-color-scheme` (ADR-028). R8's question is answered by neither of its options and the ADR records why. For a crawler: canonical links, a description from the first paragraph, Open Graph tags, `Article` structured data, `lastmod` from the head revision, `Link: rel=preload`, and never a `noindex`. For a reader: an `ETag` that elides the per-response CSP nonce, a `304`, and one stylesheet served `immutable` because its address is its own hash. No public route reads a session, so a member and a stranger get the same bytes. Renaming or moving a published page writes its old address into `public_redirects` from two outbox consumers and answers it with a `301` (ADR-035); the sitemap never lists it. Every surface is rate limited per source address on its own large budget. **Web half pending:** the publish switch in a collection's settings, the access screen that writes the deny, the "Open in the app" affordance — which cannot be decided on a page cached for everyone — and `e2e/publish-public.spec.ts`. **Still pending on this half:** public publishing’s web half — the publish switch in a collection’s settings, the access screen that writes the document-scope deny, and `e2e/publish-public.spec.ts`; theme **delivery** — ADR-028's resolved token set served with the page and cached by content hash — is not built either, so a saved theme is stored and previewed but not yet applied, which the theme screen says on screen; theme onboarding's guided flow (logo, three questions, suggestion) is a later branch with its entry point left in the theme editor; the app shell still reads its signature variants from the theme rather than from the layout settings (a `TODO(M3)` in `workspace-layout.tsx`, ADR-028's rename). Single sign-on's `e2e/sso.spec.ts` journey is done (#13, four profiles, against the fake provider as its own process). |
| M4 — Comment and sync | **Not started.** Comments have a data model and a panel primitive only. |
| M5–M8 | Not started. |

**Distance to Release 1 (the MVP in §34):** the M2 remainder, the rest of M3 (search is done, server and surface both), and all of M4, then the Release 1 journeys on all four browser profiles. By volume that is roughly what has been built so far, again: search and share links are moderate; public server-side rendering, comments with re-anchoring, and remote Git sync are each substantial; operations (container image, backup and restore, upgrade path) is small but must be exercised for real.

---

---

# Part I — Product

## 1. Vision

Quill is an open-source, self-hostable documentation platform whose purpose is to make excellent documentation the easiest thing to create, maintain, discover, and consume.

It sits between Confluence, Notion, GitBook, Outline, Docusaurus, and Backstage TechDocs without cloning any of them. It combines Markdown portability, rich editing, beautiful rendering, strong information architecture, versioning that costs the author nothing, comments, sharing, public publishing, Git-aware content, and provider-neutral integrations.

The intended feeling:

> A thoughtfully designed publishing system for organisational knowledge.

Not:

> Enterprise wiki software with a nicer UI.

## 2. North star

Every product and architectural decision is evaluated against one question:

> Does this make it easier to create, maintain, understand, find, or trust documentation?

## 3. First users

The first users are **software development teams** inside one organisation. That organisation may contain several companies, departments, and teams.

This choice sets the first release. Developers expect:

- Markdown they can also edit in a repository.
- Code and diagrams that render well.
- Links to source at an exact revision.
- Search that finds the runbook during an incident.
- Versioning they never have to think about.
- Public docs for the things they ship.

Templates for healthcare, legal, and other industries are not a first-release concern. They remain a later opportunity once the document model has proven itself.

## 4. Core product principles

1. **Documentation first.** Nothing is added that does not serve creating, maintaining, discovering, or consuming documentation.
2. **Beautiful by default.** Typography, spacing, tables, code, diagrams, callouts, and print all look excellent without manual styling.
3. **Simple until complexity earns its place.** Open a workspace, create a document, start writing. Everything else is progressive disclosure.
4. **Structure without bureaucracy.** Good information architecture should emerge; it must never be required.
5. **Portable by design.** Markdown is the durable representation. Nothing is trapped in Quill.
6. **Versioning is free.** Every publish is a version. Authors never stage, commit, branch, or push.
7. **Source provenance.** When content came from somewhere else, Quill can answer "where did this come from?"
8. **Interactive when useful.** Interactive documents remain documents, with a useful static form.
9. **Open and extensible.** Providers, storage, search, identity, and embeds are replaceable at defined boundaries.

## 5. Explicit non-goals

Quill will not become a project management tool, chat application, spreadsheet, database builder, whiteboard, workflow engine, low-code platform, or an AI-first product. AI assistance may later sit on top of the document model, never underneath it.

## 6. Licence and name

MIT, for the whole codebase. There is no open-core split. Enterprise features such as SAML and SCIM ship under the same licence when they are built.

**"Quill" is a code name.** The final product name is not yet chosen, and the code name collides with the Quill.js editor, so a rename before the first public release is expected. The repository is built to make that rename mechanical:

- A single `packages/brand` module is the only place the product name, slug, and package scope are written. UI text, page titles, emails, CLI output, container image names, and development defaults derive from it.
- The `quill/no-brand-literal` lint rule (`tools/oxlint-plugin`, run by `pnpm lint`) fails the quality gate if the code name appears in application or package source outside the brand module. Documentation, tests, and the plan are exempt.
- A `pnpm rename` script rewrites the package scope, imports, development defaults, and documentation to the new name in one reviewed change.
- Persisted formats that carry the name (the content store's metadata directory, database defaults) are frozen at Release 1, so the rename must land before then.

---

# Part II — Decision register

Decisions taken during review. Each will be recorded as an ADR in the research phase; the ADR may add detail but should not reverse these without a documented reason.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Licence: MIT.** | Maximum adoption and contribution; no open-core friction. |
| D2 | **Backend runtime: Node 24 LTS, moving to Node 26 when it enters LTS in October 2026.** Native TypeScript via type stripping; `erasableSyntaxOnly` enforced; explicit `.ts` import extensions; no path aliases. | One language end to end. The Markdown pipeline (remark) is JavaScript and must run server-side. Odd Node releases are never LTS; Node 25 is end-of-life. |
| D3 | **HTTP server: Fastify.** Schema-validated routes generating an OpenAPI description; typed client generated from it. | Mature under load, fast, reliable plugin ecosystem. |
| D4 | **Database: PostgreSQL** for everything that is not document content. Drizzle for schema and migrations. | Ubiquitous, cloud-managed everywhere, full-text search built in. |
| D5 | **Content store: a Git-compatible object engine, fully hidden from users.** Backends: bare repository on a filesystem, objects in Postgres or S3-compatible storage, and optional sync with an external remote repository. | Revisions, diffs, restore, and Git sync are written once. Filesystem, database, and cloud backing are the same engine with different object storage. |
| D6 | **Drafts live in Postgres, not the content store. Publish is the only write to the content store.** | Autosave does not create commits. Versions are meaningful. Real-time collaboration later changes only the draft layer. |
| D7 | **Concurrency for the first release: per-document draft locking**, designed for reliability (heartbeat, expiry, takeover, optimistic draft versions, local recovery). Real-time co-editing via Yjs later. | Simultaneous editing is not a first-release requirement. Locking done well is simpler and safer than CRDTs done early. |
| D8 | **Tenancy: one organisation per deployment**, modelled as an **organisational unit tree of arbitrary depth** (companies, departments, teams), with nested groups and scope-based role grants. | Fixed "company" and "team" levels would be a rewrite when a third level appears. |
| D9 | **Editor: ProseMirror via TipTap**, with CodeMirror 6 for code blocks and an optional raw Markdown mode. The remark AST is canonical; the editor document is derived. | Decade-old reliability, schema-based nesting that matches Markdown, standard collaboration path, MIT core. |
| D10 | **Search: PostgreSQL full-text search behind a search interface**; Meilisearch or similar as a later adapter. | Zero extra services for self-hosters; interface prevents lock-in. |
| D11 | **Comments are in the first release**, stored outside the document as W3C-style selectors with the revision hash they were made against, rendered as editor decorations. Never written into Markdown. | Markdown stays clean for Git users; re-anchoring survives external edits. |
| D12 | **Review workflow is deferred**, with its extension points built in the first release (publish as a domain command, separate drafts, status as an extensible union, comments tied to revisions). | Wanted, not needed first. Cheap to keep open. |
| D13 | **Share links with configurable permissions are in the first release.** | Requested; also proves the anonymous principal. |
| D14 | **Public, crawlable publishing is in the first release**, served as server-rendered HTML for anonymous requests. | Developer teams publish docs. Crawlability requires server rendering. |
| D15 | **First users: software development teams.** Git sync and source references are therefore first-wave differentiators, not a later phase. | Sets scope and order. |
| D16 | **Attachments live in a blob store**, referenced by content hash. Small images may optionally also be committed into the content store under a size threshold. | Keeps repositories small; keeps exports self-contained. |
| D17 | **Stable document identity is a UUID in front matter.** Paths, slugs, and titles are mutable; the ID is not. | Links, comments, history, and Git sync all survive rename and move. |

---

# Part III — Architecture

## 7. System overview

```text
                 +---------------------------------------------+
  Browser        |  Web app (React SPA)   Public site (SSR HTML)|
                 +---------------+-------------------+---------+
                                 | OpenAPI           |
                 +---------------v-------------------v---------+
  Server (Node)  |  Fastify: API, SSR renderer, auth, sync jobs |
                 |  Application layer -> Domain layer           |
                 +---+-----------+-----------+----------+-------+
                     |           |           |          |
              +------v---+ +-----v-----+ +---v----+ +---v----------+
              | Postgres | | Content   | | Blob   | | Search index |
              | system   | | store     | | store  | | (PG FTS,     |
              | data     | | (Git      | | (FS or | |  adapter     |
              |          | |  engine)  | |  S3)   | |  later)      |
              +----------+ +-----+-----+ +--------+ +--------------+
                                 | optional background sync
                          +------v------+
                          | Remote Git  |
                          | repository  |
                          +-------------+
```

Dependency direction inside the server and the web app:

```text
UI -> Features -> Application -> Domain <- Infrastructure
```

- Domain does not depend on React, Fastify, Drizzle, or any provider.
- Infrastructure implements interfaces the domain and application layers declare.
- External APIs terminate at provider boundaries.
- Every API route calls an application service; no route touches storage directly.

## 8. Repository layout

A pnpm monorepo. One language, one toolchain.

```text
apps/
  server/            Fastify app: routes, SSR, jobs, wiring
  web/               React app: TanStack Router, Query, Store
packages/
  domain/            Entities, value objects, permission rules, pure TypeScript
  application/       Use cases and services; depends on domain and interfaces
  markdown/          remark/rehype pipeline, front matter, AST <-> ProseMirror converter
  content-store/     Git-engine content store and its backends
  search/            Search interface and PostgreSQL implementation
  providers/         Git, identity, embed providers behind capability interfaces
  api-client/        Generated from the server's OpenAPI description
  ui/                Design tokens and accessible primitives
  config/            Shared tsconfig, oxlint, oxfmt, test configuration
docs/
  research/          Investigation write-ups
  architecture/      ADRs
  operations/        Deploy, backup, upgrade guides
spikes/              Throw-away prototypes; deleted when their ADR lands
```

Spike code is the only throw-away code the project plans to write. It lives in `spikes/`, is never imported by a package, and is removed when its ADR is accepted.

Inside `apps/web`, the structure from the review draft applies: `app/` (router, providers, layouts), `components/` (primitives, ui), `features/` (documents, workspaces, search, comments, sharing, revisions, permissions, authentication, integrations), with domain and application logic imported from packages rather than duplicated.

## 9. Content store

The content store is the only place published document content lives. It is a Git object model implemented in `packages/content-store` over a six-method `ObjectStore` port, writing standard Git objects into a bare repository that the real `git` CLI can read. There is no working directory, no index, no checkout, and a single branch. Research R4 confirmed this design and measured it; ADR-014 records the details. Three findings shape operations: the Postgres revisions index is on the critical path for history (walking the repository is unusable interactively), scheduled packing of the filesystem backend is mandatory because publish p95 degrades as loose objects accumulate, and remote sync uses `isomorphic-git` on a materialised repository so Quill never implements the Git wire protocol.

### 9.1 Interface

The application layer speaks this vocabulary and nothing lower:

```ts
interface ContentStore {
  read(documentId: DocumentId, revision?: RevisionId): Promise<DocumentSource>
  publish(change: ContentChange, base: RevisionId | null): Promise<PublishResult>
  history(documentId: DocumentId, page: Page): Promise<RevisionSummary[]>
  diff(a: RevisionId, b: RevisionId): Promise<ContentDiff>
  listTree(workspaceId: WorkspaceId): Promise<TreeEntry[]>
}
```

Repositories, trees, refs, and commits never appear above this interface. That is the test that keeps the engine replaceable.

### 9.2 What a publish does

1. Load the draft and its base revision hash.
2. Serialise the AST to Markdown deterministically.
3. If the base is stale, attempt a three-way merge of the Markdown; on conflict return a merge-required result.
4. Write the blob, build a tree from the previous tree with that blob replaced, write a commit with the user as author and Quill as committer, and advance the ref with compare-and-swap. On CAS failure, retry against the new tree.
5. Record the revision in the Postgres revisions index and emit a `DocumentPublished` event.

Commit messages are generated from the document title and optional change note, and carry trailers (`Quill-Document-Id`, `Quill-Change-Note`) so the revisions index can be rebuilt from the repository alone.

Restore is a new commit with old content. Move and rename are commits at a new path. Delete is a commit removing the file; the document remains recoverable through history. Bulk operations produce one commit.

### 9.3 What users see

| User action | What the server does |
|---|---|
| Typing, autosave | Draft written to Postgres. Content store untouched. |
| Publish | One commit, authored by the user. |
| History | Read from the revisions index, keyed by document ID. |
| Compare | Two blobs by hash, diffed and rendered. |
| Restore | New commit with the old content. |
| Move or rename | Commit at the new path; history follows the ID. |
| Delete | Commit removing the file; recoverable from history. |
| Import, bulk move | One commit for the whole operation. |

The words stage, commit, branch, push, and merge do not appear in the product.

### 9.4 Backends

| Backend | Object storage | Use |
|---|---|---|
| Filesystem | Bare repository on a volume | Default self-host; simplest backup |
| Database or object storage | Git objects in Postgres or S3-compatible storage | Cloud deployments without persistent volumes |
| Remote sync | Either of the above plus a background job pushing to and pulling from an external repository | Workspaces that opt into Git-managed documents |

### 9.5 On-disk layout

The repository must make sense to a human who clones it. Proposed default, to be confirmed by the storage spike:

```text
<workspace-slug>/
  README.md                       workspace landing page
  engineering/
    index.md                      "Engineering" document, parent of the folder
    architecture/
      index.md
      system-overview.md
      authentication.md
    runbooks/
      index.md
  .quill/
    workspace.yaml                schema versions, publish settings, nav overrides
```

Front matter carries `id`, and ordering is a sparse integer `order` field so reordering rarely touches more than one file. Attachments referenced by hash live in the blob store; small images under the threshold are also written to `assets/` beside the document.

### 9.6 Remote sync

Sync is a background job, never a button. After each publish the job pushes. A webhook or poll pulls. Externally changed files are parsed, validated, assigned an ID if they lack one, and recorded as revisions by "external" with the commit's author shown. Overlapping changes that fail a three-way merge mark the document "needs attention" for its editors with a side-by-side view. Sync failures notify workspace admins, not writers.

## 10. Drafts and locking

Drafts are rows in Postgres holding the AST as JSON plus a draft version number and the published revision they are based on. Reliability rules:

- **Lock table.** One row per document: holder, session, acquired, last heartbeat, expiry. Acquire is a single `INSERT ... ON CONFLICT DO UPDATE WHERE expires_at < now()` so there is exactly one holder and no race.
- **Heartbeat** every 15 seconds while the editor is open; expiry after 60 seconds without one. Nothing sweeps; expiry is checked on every acquire.
- **Release** on close, on navigation through `sendBeacon`, and on expiry. A crashed browser loses its lock in a minute.
- **Takeover.** The document's editors can take over an expired lock; workspace admins can take over an active one. The previous holder's next write is rejected and the client keeps its changes locally with a "your changes are preserved" recovery path.
- **Optimistic draft versions.** Every draft write carries the version it read. A stale write is rejected, which makes two tabs by the same user safe.
- **Local recovery.** The client keeps the unsent draft in IndexedDB until the server acknowledges, and resends on reconnection.
- **Presence.** Readers of a locked document see who is editing, via polling first and server-sent events later.

Tests for this module use a fake clock and two simulated clients, and include network partition and lock-takeover scenarios. This is one of the places where full behavioural coverage is required, not aspirational.

## 11. Data model

Postgres holds system data. The content store holds document bodies. Blob storage holds attachments.

```text
Instance
OrganisationalUnit            tree; label chosen by admin (company, department, team)
User
Group                          scoped to a unit; may nest
Principal                      user | group | public | share-link
Grant                          (principal, scope, role); scope = unit | workspace | collection | document
Role                           owner | admin | editor | contributor | viewer

Workspace                      belongs to a unit
Collection                     top-level grouping inside a workspace
Document                       id, workspace, parent, slug, path, status, metadata
Draft                          document, ast, draft_version, base_revision
DocumentLock
RevisionIndex                  document, revision hash, author, timestamp, summary
DocumentLink                   source, target, kind (link, embed, mention)
Tag, DocumentTag

Attachment                     blob hash, mime, size, owner document
ShareLink                      token, scope, role, expiry, password?, created by
CommentThread, Comment         selector, revision hash, status, replies
AuditEvent
OutboxEvent                    transactional events for indexing, notifications, webhooks
Integration, ProviderConfig
SearchDocument                 tsvector columns, permission scope
```

A collection is a first-level container inside a workspace that carries its own grants and publish settings; documents nest below collections. A document belongs to exactly one place in the tree. This resolves the ambiguity in the review draft.

## 12. Tenancy and permissions

- The instance is the root unit. Units nest to any depth. Units are private by default: Company A cannot see Company B without a grant.
- Grants attach a role to a principal at a scope. Effective permission is resolved **per principal and then combined**: each principal a request holds is decided by the nearest scope on the document's chain that grants to *that* principal, and the results are combined by taking the highest role. A deny is available at document scope for private documents; a deny on a **person** (user or group) discards every allow that is not strictly nearer the document, whoever holds it, while a deny on a **channel** (public or a share link) removes only that principal's own contribution. So a nearer grant lowers only the principal it names, an explicit allow below a deny wins, a grant to **public** — which every request holds — can only ever widen access, and one document can be taken off the public web without hiding it from the members who write it (ADR-012, amended 2026-09-12).
- Groups can be nested and will map to SCIM groups later.
- The **public** principal is a real principal from the first release. A public collection is a Viewer grant to public. A share link is a principal with a token.
- An **instance admin** role exists separately from workspace owner.
- Permission resolution is a pure domain function, and the rule for combining principals is written once so the resolver and the materialised table cannot drift apart. A materialised effective-permission table, rebuilt by outbox events on grant changes, serves search filtering and list views; it stores one row per document and principal, denies included, with the scope that decided each one, and a consumer combines the rows for the principals it holds.
- Grants are written only through the `createGrant` use case, which validates them against the domain rules — deny only at document scope, public never above viewer — before anything is stored.

## 13. Comments

- A thread is anchored by a selector: exact quote with prefix and suffix, the AST path, the character range, and the published revision hash it was created against. Unanchored page-level threads are always allowed.
- In the editor, threads render as ProseMirror decorations whose positions are mapped through edits during a session. On publish, selectors are recomputed and stored.
- When a revision arrives from outside the editor, a re-anchoring pass matches quotes against the new content. Anything it cannot place is shown as orphaned with its original text, and can be re-attached by a user.
- Threads have status (open, resolved), replies, mentions, and produce notifications through the outbox.
- Comments never enter the Markdown and are not exported with it; a separate JSON export exists for completeness.

Because every comment records its revision hash, the later review workflow can attach threads to a proposed change without a data migration.

## 14. Share links and public publishing

**Share links.** A link is a token mapped to a grant: scope (document or subtree), role (view first; comment and edit later), expiry, optional password, revocation, and creator. Workspace policy controls whether links may be created and with which maximum role. Every use is audited.

**Presenting to a room.** Any document has a full-screen presentation mode for presenting a design, plan, or review to a team, in person or over a screen share. It is a reading mode, not a separate artifact: the document's sections become steps, type scales for a projector, wide and full blocks use the whole screen, and the only chrome is a progress bar, a section rail, and a presenter bar that fades when idle. Keyboard navigation moves between sections, a "go to" overlay lists them, and presenter notes come from a `:::notes` directive that is never shown to readers. While presenting, one keystroke opens a **note for later**: a private note for the edits and follow-ups that come up in the room, anchored to whatever the presenter is pointing at, using the same selectors as comments: the current section by default, the focused block if one is selected, or the exact highlighted text with its quote. Notes are private comment threads (section 13), so they need no new storage; when the presentation ends, and again when the document is next opened in the editor, they appear as a checklist that jumps to each section and can be turned into a comment for others or resolved. Presentation mode ships in M2 with the reading view, since it is the same renderer with different layout tokens; notes for later ship with comments in M4.

**Public publishing.** A workspace or collection can be published. Publishing sets a slug or path, branding, navigation, and creates a Viewer grant to the public principal.

- Anonymous requests to public routes receive server-rendered HTML, content-addressed by what it was rendered from, so nothing has to be invalidated.
- Sitemaps, canonical URLs, robots rules, and Open Graph metadata are generated.
- Public search is scoped to public content only and rate limited.
- The authenticated application remains a single-page app. The server-rendered path is neither a Fastify-hosted React render nor TanStack Start: the document's body is already HTML in the render cache, and the page around it is four small templates, so the public site ships no JavaScript. What is shared with the application is the renderer's output and the design system's CSS (ADR-023's implementation note).

## 15. Search

- PostgreSQL full-text search with weighted columns: title A, headings B, body C. `pg_trgm` for fuzzy matching and typo tolerance. `ts_headline` for snippets.
- Filters: workspace, collection, tag, owner, status, updated range.
- Permission filtering joins the effective-permission table; results never leak titles the user cannot read.
- **The effective-permission table is built in M3**, with the events that keep it true: `GrantCreated` and `GrantRevoked`, `DocumentMoved` (a move changes the chain a document inherits from), and `CollectionCreated`/`CollectionDeleted`. Until it exists, search and the flat document list resolve the same answer by walking a workspace with `materialiseEffectivePermissions` and combining with `combineContributions` — correct, and bounded per request to five workspaces at a time — and the table replaces that walk with a join without either caller changing. It is not cached in the meantime: a stale permission index is a disclosure, not a slow query.
- Ranking is by relevance within a **workspace affinity** order: results from the current workspace come first; below them, matching documents from every other workspace the user can at least read are offered as suggestions, grouped by workspace. Search is the one surface that crosses workspaces; the navigation sidebar never does.
- Indexing runs from `DocumentPublished` outbox events. A reindex command rebuilds from the content store.
- Interface:

```ts
interface SearchIndex {
  index(doc: IndexableDocument): Promise<void>
  remove(documentId: DocumentId): Promise<void>
  query(q: SearchQuery, principal: Principal): Promise<SearchResults>
}
```

Semantic or hybrid search later adds an implementation, not a redesign.

## 16. Markdown and the AST

- Markdown is the durable source. The remark AST (mdast) is the working representation shared by the editor converter, renderer, search indexer, validator, and exporters.
- Standard CommonMark and GitHub Flavored Markdown first. YAML front matter validated by JSON Schema, with core, workspace, and template schemas, and schema versions.
- Extensions use directive syntax (`:::callout`, `:::decision`) and must degrade to readable content outside Quill. Mermaid is a fenced code block.
- Unknown front matter fields and unknown directives are preserved through the round trip. This is a hard rule tested by property-based round-trip tests.
- Serialisation is deterministic and formatting-stable: re-serialising an unchanged AST produces byte-identical Markdown. Where an author's original formatting differs from the canonical form, the first publish from the editor normalises it once, and the diff view labels formatting-only changes.
- Fidelity levels are named explicitly: **byte-preserving** for documents never opened in the editor, **semantic-preserving** for everything opened, and **canonical** for output. The review draft asked which level is required; this is the answer.
- **Syntax highlighting (ADR-030).** One tokenizer (Prism grammars) runs on the server at render time and emits each code block as a single text node with packed token ranges. The client paints them through the CSS Custom Highlight API where supported and swaps in Prism-style spans where not, so readers never download grammars and a large block never becomes thousands of DOM nodes. Token colours are theme tokens consumed by both presentations, a coverage test guarantees every token class a grammar can emit is themed, static exports use server-rendered spans, and the editor's CodeMirror blocks map onto the same variables.
- **Live blocks (ADR-032).** Parts of a page that change on their own cadence (a branch-following code snippet, an embed, a list of documents matching a tag, a query result, a service status) are declarative directives from a registry of block types, never code. Each type has a schema, a server-side fetcher, a cadence (on view with a lifetime, scheduled, or push), a static renderer with an "as of" stamp for exports and readers without JavaScript, and a client island that subscribes to updates. The cached body holds a slot; snapshots live in their own store and fill the slot at page assembly. Viewer-scoped blocks render client-side only and are never snapshotted. This is the bounded answer to "MDX": one line of Markdown, readable in a diff, no execution surface in documents.
- **Templates are starting points (ADR-029).** A template gets an author to a good document quickly and works as it is in most cases and never constrains what happens next. "Required" sections express a business rule: they are visually indicated in the editor, at publish, and as a quiet quality signal afterwards, but not enforced for now; the flag keeps its meaning so enforcement can be offered later without migration. A template is Markdown with a `template:` front matter block declaring questions, required and optional sections, and the metadata it stamps on new documents. Questions are asked at creation, become front matter fields on the document, and control which sections exist, which metadata and defaults apply, and which interactive capabilities are scaffolded. Template-only directives (`:placeholder`, `:::guidance`, `:::optional`, `:::when`, `:::repeat`) shape the writing surface and never reach a published revision. The blocks and schema land in M2 with the markdown package; the gallery, built-ins, and template editor land in M5.
- **Block layout widths.** Any block, or group of blocks, can be **content** width (the reading measure), **wide**, or **full** (the whole main region), by wrapping it in a `:::wide` or `:::full` container directive. A document can set a default in front matter (`layout: full`). Outside Quill the wrapper is ignored and the content renders normally. The reading and editing surfaces share one CSS grid with named lines, sidebars live outside that grid so nothing collides, and below the medium breakpoint all widths collapse to the viewport. Tables always scroll horizontally within their width; images never upscale past their intrinsic size. See ADR-027.

## 17. Editor

- ProseMirror through TipTap. Schema nodes mirror mdast node types one to one, plus Quill directive blocks. CodeMirror 6 provides code blocks and a raw Markdown mode.
- The converter `mdast <-> ProseMirror document` is pure TypeScript in `packages/markdown`, covered by round-trip tests over a corpus of real documents.
- The editor state is never persisted directly. Drafts store the AST.
- Slash commands, bubble menus, drag handles, paste-Markdown, paste-URL to embed, keyboard shortcuts, and unsaved-change protection ship with the first editor.
- Every block's menu exposes its layout width (content, wide, full). The author sees the block at its chosen width exactly as a reader will; the directive wrapper is never shown as a separate block.
- Accessibility of the editor is tested with screen readers on the supported browsers in every milestone that touches it, because it is the hardest surface to fix late.
- TipTap's paid extensions are not used. Comments, collaboration, and file handling are built on Quill's own data model.

## 18. Frontend architecture

Unchanged from the review draft in substance:

- React, TypeScript, Vite, Tailwind CSS with semantic tokens, TanStack Router for URL state, TanStack Query for server state, TanStack Store for genuinely shared client state, React state for local UI, plain TypeScript for domain and application logic.
- `useEffect` is for synchronising with external systems only. No effect chains. No state used as a command bus.
- Components render and handle interaction; business logic lives in packages and is tested without rendering.
- Accessible primitives: button, input, select, dialog, dropdown, tooltip, tabs, badge, table, callout, breadcrumb, tree, command palette, Markdown content, code block, empty, loading, and error states.
- Dependency rules between layers are enforced mechanically by lint rules, not by convention.

## 19. Providers and integrations

- A **provider** is an implementation; an **integration** is a configured instance of one.
- Capability-specific interfaces (`FileProvider`, `RevisionProvider`, `RepositoryProvider`, `WebhookProvider`, `IdentityProvider`, `EmbedProvider`) rather than one universal abstraction.
- Provider-neutral domain concepts: `Repository`, `SourceFile`, `Revision`, `SourceReference`. External API types never cross into the domain.
- Architectural test: Bitbucket support can be added without changing the document domain.
- Credentials for integrations are stored encrypted with a per-instance key, scoped to the unit that created the integration, and never exposed to the web app.

## 20. Source references, source artifacts, embeds

- **Source references** render code from a repository at an exact revision with line ranges, syntax highlighting, copy, expand, and links back to the source. Floating references to a branch are allowed but immutable references are the default in templates for ADRs, postmortems, and security documents.
- **Source artifacts** pair a rendered representation with its source (Draw.io, Mermaid, SQL, chart data). The artifact is an attachment with a declared source type; rendering is cached by content hash.
- **Embeds** follow URL, provider detection, metadata resolution, preview, optional embedded view. Open Graph and oEmbed first. Unknown providers become link cards. Third-party content is sanitised, CSP-restricted, sandboxed in iframes, and subject to workspace allowlists.

## 21. Interactive documents

Deferred to a later wave but constrained now:

- Interactive definitions live in Markdown directives with a readable static form.
- Interactive user state is stored separately from document content and never creates a revision.
- Directives may inform and collect input. They may not perform external actions without an explicit integration, authorisation, confirmation, and audit trail.
- The directive syntax uses ASCII only. The review draft's `Yes -> service-health` example with a Unicode arrow is replaced by plain list items with explicit target IDs.

## 22. Events, jobs, and notifications

- An **outbox table** written in the same transaction as the change is the single event mechanism. Consumers: search indexing, effective-permission rebuild, notifications, remote sync, webhooks, audit.
- A small in-process job runner with Postgres-backed queues serves the first release; a separate worker process is a deployment option, not a code change.
- Notifications are in-app first, email second. Event names: `DocumentCreated`, `DocumentPublished`, `DocumentMoved`, `DocumentDeleted`, `RevisionRestored`, `CommentCreated`, `CommentResolved`, `ShareLinkCreated`, `GrantChanged`, `MemberAdded`.
- No event sourcing.

## 23. Authentication and security baseline (ADR-011)

- First release: email and password, magic links, password reset, email verification, OIDC with PKCE, and **passkeys** (WebAuthn), which are the modern default and cheaper to add now than to retrofit.
- Later: SAML, SCIM, TOTP as a second factor for accounts that cannot use passkeys.
- Standards followed: OWASP ASVS and Cheat Sheets, NIST 800-63B, WebAuthn Level 3. Concretely: Argon2id at the OWASP minimum with breached-password checks and no composition rules; tokens and session ids stored hashed; `__Host-` cookies with `SameSite=Lax` plus fetch-metadata and origin checks instead of CSRF tokens; session rotation and server-side timeouts with revocation; strict CSP with nonces; schema-validated input; server-side sanitised Markdown before caching; an SSRF-safe outbound client for embeds and source references; rate limits with backoff; audit without secrets. `docs/security/checklist.md` is part of the definition of done for any change in these areas.
- **Enterprise SSO.** Microsoft Entra ID (Microsoft 365), Google Workspace, Okta, Auth0, and Amazon Cognito are all OIDC providers, so one OIDC implementation with providers expressed as data presets (issuer template, claim checks, group claim, logout quirks) covers them, and adding a provider is adding a preset: pinned tenant for Entra, hosted-domain check for Google, verified-email requirement everywhere, identities keyed by issuer and subject rather than email, just-in-time provisioning with a linking policy, and "require SSO for this domain". Group claims map to groups at sign-in as a first version; SAML 2.0 and SCIM provisioning arrive in the enterprise phase on the same `IdentityProvider` port. Personal API tokens arrive with the public API.

## 24. Export and import

- Export: Markdown (single or ZIP with assets and source artifacts), HTML, PDF with professional print styling, JSON. DOCX later.
- Import: a folder or ZIP of Markdown with front matter is the first importer, and it is the same code path as remote sync. Confluence and Notion importers follow, because migration decides adoption.

## 25. Operations

Self-hosting is a founding pillar, so production operation is designed, not discovered.

- **Packaging.** One container image containing server and built web app. Requires Postgres. Optional S3-compatible storage and SMTP. No other services for the first release.
- **Configuration (ADR-034).** Three places by nature: how the process runs is environment (`.env` locally, the platform's secret store in production) with `.env.example` as the complete reference and secrets never in the image or the database; what an organisation configures in the product (SSO, policies, themes, structure, membership) is Postgres, secrets encrypted with the instance key; what describes the documents (`.quill/workspace.yaml`, template documents) is a file in the content store so it travels with them.
- **Settings as files, secrets as ciphertext (ADR-034).** Organisation settings that need no database row (themes, policies, publish and navigation settings, template registration, structure) are versioned files in a system workspace of the content store, written by the application through the publish path, so they have history, move by copying, and survive concurrent servers through compare-and-swap. Secrets entered in the product are stored in Postgres under envelope encryption with a master key from a `KeyProvider` (environment, key file, or a cloud key service) and are referenced from settings files by name, never by value.
- **Human-readable URLs (ADR-035).** Internal links are `/w/<workspace slug>/d/<title-slug>-<short key>`: the ten-character key, unique across the instance, assigned at creation and never changed, decides; the words are corrected on the fly; the UUID form keeps resolving. Public site links (M3) are path-shaped with a redirect table. Every link is built by one helper.
- **Data classification (ADR-034).** The content store, the blob store, and the Postgres tables with no file form (users, credentials, grants, comments, drafts, share links, audit, settings) are systems of record. Everything else in Postgres is an index rebuilt from them by `quill reindex`: document metadata columns, the revisions index, render cache, links, search, effective permissions. With only the content and blob stores you keep every document, revision, and attachment and rebuild every index; you lose accounts, permissions, comments, drafts, and settings.
- **Migrations.** Run on startup with an advisory lock; every release is upgradeable from the previous one, and the upgrade guide records anything manual.
- **Health.** Liveness and readiness endpoints; structured JSON logs; OpenTelemetry traces and metrics optional.
- **Backups.** A `quill backup` command produces a Postgres dump, a content-store bundle, and a blob manifest; `quill restore` reverses it. Documented recovery point and recovery time. A restore drill is part of the release checklist.
- **Packing.** A scheduled maintenance job packs the filesystem content store, taking the same ref lock the store uses. Publish latency is monitored at p95, which is where loose-object accumulation shows first.
- **Scaling.** Stateless server processes; content store on shared storage or object storage; job runner can be split out. Sufficient for a single organisation of thousands of users.
- **Cloud.** The same image runs on any container platform with managed Postgres and object storage. A reference Compose file and a Helm chart ship with the first release.
- **Security.** Rate limiting, CSRF protection, strict CSP, dependency audit in CI, a `SECURITY.md` with disclosure process, and a threat model for Quill itself written during the research phase.

---

# Part IV — Engineering standards

Condensed from the review draft; the substance is unchanged.

## 26. TypeScript and tooling

- Strict TypeScript everywhere, `erasableSyntaxOnly`, explicit domain types, discriminated unions, no `any`, no assertions to silence errors.
- oxfmt for formatting, oxlint for linting, TypeScript for type checking. Their maturity relative to Prettier and Biome is recorded in the tooling ADR, with the fallback named.
- Commands: `pnpm format`, `pnpm lint`, `pnpm lint:deps`, `pnpm check:tailwind`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm check`. CI runs exactly `pnpm check`.
- **Named patterns for complexity.** `docs/architecture/patterns.md` is the catalogue: ports and adapters as the architecture-level strategy, factory plus strategy for every configurable implementation (`createMailer(config)`, `ObjectStoreProvider.forWorkspace(id)`), registries for everything extensible (directives, live blocks, identity presets, doctor rules), observers for the outbox and editor state, use cases as commands, reducers with discriminated-union states, `Result` for expected failures, one composition root per process, and a rule of three before any pattern is introduced. Naming follows the catalogue so the shape is recognisable from the name.
- **Code quality standard.** Clean, DRY, performant, idiomatic, and self-documenting. Native TypeScript and platform features come first: array methods, native iterator helpers (available on Node 24), `structuredClone`, `Object.groupBy`, and `Temporal` once stable. `remeda` is the utility library when native code would be clumsy: typed, tree-shakeable, lazy in `pipe`. `rotery` serves iterable and async-iterable pipelines, which is where large document trees, search streams, and sync jobs live. A small owned utility is written when the same shape appears three times, and it lives beside the concept it serves rather than in a generic utilities folder. lodash, lodash-es, underscore, and ramda are rejected by a lint rule. `rotery` is pre-1.0 as of September 2026, so its minor version is pinned and upgrades are reviewed. Names carry the what; comments carry the why.

## 27. Testing

- TDD for meaningful behaviour: red, green, refactor.
- Coverage target is full meaningful coverage of domain, application, markdown, content-store, and search packages, with rare, explicit, reviewed exclusions. UI packages target behavioural coverage of interaction, not line counts.
- Pyramid: unit for domain, parsers, permissions, converters; integration for application services, persistence, content store, search, providers, sync; component for rendering, interaction, and accessibility; end-to-end for the critical journeys listed in Part VI.
- Round-trip fidelity, lock reliability, permission resolution, and re-anchoring are property-tested.
- If something is hard to test, the architecture is questioned first.

## 28. Local development

Clone, install, one command, running application with seed data: a unit tree, two workspaces, users in each role, example documents, a public collection, a share link, comments, and a synced repository fixture. Docker Compose provides Postgres and MinIO. No external SaaS is needed to run or test.

## 29. Design system, accessibility, browsers, responsive

- Tailwind with CSS variables and semantic tokens: background, surface, foreground, muted, border, accent, success, warning, danger. Light and dark from the first release. Tokens are two layers, a raw palette per theme and a semantic layer that references it, so a theme is a change of palette, never a recompilation (research R13).
- **Themable in layers (ADR-028).** Layer 0 is invariant: spacing, type scale, control sizes, the layout grid, focus, motion, and contrast floors. Layer 1 is the **theme**, chosen by the tenant: a declarative document that picks a type pairing from the curated set, a radius and density step, and colour seeds (neutral tone and one accent hue). Identity never varies inside an organisation. **Layout** is separate from theme: the bounded set of structural variants (sidenotes or side panel, revision timeline or history menu, coloured collection tabs or plain tree, status readout or breadcrumb, rules or hairlines or cards) is chosen per workspace with an organisation default, because a product workspace may want a different structure from an engineering one while sharing the same identity; each built-in theme recommends a layout as its starting point (ADR-028 amendment, 12 September 2026). Built-in themes are Press, Instrument, and Atelier; a custom theme is the same document, forked and validated. Layer 2 is **tenant customisation**: a built-in theme is a complete starting point, not a boundary. The guided levers (accent, tone, logo, reading face, radius, density, collection colours) come first and are all most tenants touch; every token, variant, and font underneath remains editable, with the theme doctor advising rather than blocking. AA text contrast is the one rule enforced by default, and an instance administrator can make it advisory. Layer 3 is **user preferences**: light, dark, or system, text size, reduced motion, high contrast, which no tenant can remove. Light and dark palettes are generated from the seeds in OKLCH and contrast-checked automatically, so a custom accent is safe by construction. The theme applies wherever a document appears: application, public site, presentation mode, and exports. No custom CSS in the first release. A tenant's first theme comes from a guided **onboarding flow**: upload a logo and brand colours, answer three questions about content, feel, and density, get a suggested built-in theme shown on a real document in light and dark, tweak the levers with live contrast checking, and save it as a fork that can be adjusted or reset later.
- **Direction.** Polished and elegant, with an identity of its own, not sterile and not a component-library look. Three directions are on the design canvas (`docs/design/canvas`): Press, Instrument, and Atelier. All three are built-in themes, and Instrument is the default, so the design system is tuned on it first.
- WCAG 2.2 AA. Keyboard navigation, focus management, reduced motion, accessible tables and editor controls.
- Current Chrome, Edge, Firefox, Safari on desktop, tablet, and mobile. Editor behaviour, clipboard, uploads, drag and drop, printing, and dialogs are tested per browser.
- Mobile is designed, not shrunk: reading, search, navigation, light editing, tables, and dialogs must work on small screens.

## 30. Definition of done

A feature is complete when it has correct layering, tests written first, meaningful coverage, type safety, accessibility, responsive behaviour, browser compatibility, loading, empty, and error states, performance considered against the budgets below, consistent visual treatment, and documentation where a user or operator needs it.

## 30a. Compatibility and regression policy (ADR-033)

- **From M2 until version 1: no regressions.** The end-to-end journey suite is the regression suite and runs on every pull request; journeys are added or deliberately retired, never weakened. Every bug fix adds the test that would have caught it. Coverage thresholds only move up. Performance budgets are checked in CI on hot-path changes. Breaking changes are allowed but never silent: each needs a changelog entry, a migration, and the journeys updated in the same change, and "breaking" never means a capability was lost.
- **From version 1 onward: everything is backward compatible.** Every persisted format (documents and front matter, directives, content-store layout, theme documents, template declarations, token ranges) is versioned and readable forever, kept honest by a format corpus of fixtures per version. Database migrations are expand and contract, upgradeable from the previous release without downtime. The API is versioned by path and additive within a version, with an OpenAPI diff in CI. Deprecations run for at least two minor versions or twelve months before removal in a major that ships its migrations first.

## 31. Performance budgets

Numbers to design against, revisited after the first release:

| Budget | Target |
|---|---|
| Document open, cached | under 200 ms to content |
| Document open, cold | under 1 s to content |
| Editor keystroke latency | under 16 ms |
| Publish round trip | under 1 s for a 30-page document |
| Search query | under 300 ms at 50,000 documents |
| Workspace tree | 10,000 documents without virtualisation problems |
| Public page, server rendered | under 500 ms time to first byte |
| Initial web bundle, gzipped | under 250 KB for the reading route; editor loaded on demand |

Performance is considered in every change, not added afterwards. Practices that apply throughout:

- **Lazy over materialised.** Document trees, search results, revision histories, and sync jobs are iterated with `rotery` pipelines, not built into arrays first.
- **Batched data access.** No N+1 queries; list endpoints load their relations in one round trip and are paginated.
- **Streaming for size.** Exports, imports, and attachment transfers stream; nothing large is buffered in memory.
- **Render discipline.** Virtualise long lists and trees, split routes, load the editor and heavy renderers on demand, and avoid re-render cascades. Memoise only where a measurement shows it matters.
- **Caching by content hash (ADR-031).** The rendered body is a pure function of the Markdown and is cached indefinitely by content hash; a publish produces a new key rather than invalidating an old one. Everything that changes without a revision (presence, comments, permissions, staleness, backlinks, revision list) travels in a separate live envelope fetched per request, and external content (branch source references, embed metadata) is cached with a lifetime and a visible freshness stamp. The body keeps itself cacheable by emitting id links, absolute times, class names, and token ranges, never titles, relative dates, colours, or per-viewer data.
- **Measure.** Hot paths get a benchmark next to their tests, and the budgets above are checked before and after changes to them.

## 32. Code review heuristics

What is this code responsible for? Does it belong in React? Can it be tested without rendering? Is this state actually state? Why does this effect exist? Is provider-specific logic leaking into the domain? Can this Markdown extension degrade cleanly? What happens to this feature on export, in Git sync, and for an anonymous reader? Does this abstraction reduce complexity?

---

# Part V — Research phase

Time-boxed investigations run in parallel with repository bootstrap, not before it, because most of them need a prototype. Each produces findings, a recommendation, trade-offs, a spike in `spikes/` where useful, and an ADR. Anything that reverses a decision in Part II must say why.

| # | Investigation | Must decide | ADR |
|---|---|---|---|
| R1 | Competitive analysis of Confluence, Notion, Outline, BookStack, Wiki.js, GitBook, Docusaurus, MkDocs, Backstage TechDocs. Now includes **comments and annotations**, **sharing and public publishing**, and **Git sync** as assessment rows. | What to borrow, improve, and avoid. | 001 |
| R2 | Markdown and AST | Fidelity levels, extension syntax, front matter schema mechanics. | 002, 004, 005 |
| R3 | Editor spike: TipTap with a hand-written mdast converter over a corpus of real documents, including tables, nested lists, directives, and code. | Converter design; confirm D9. | 003 |
| R4 | Content store spike: Git engine library choice for Node (isomorphic-git versus native bindings), bare-repo publish path, CAS ref update, three-way merge, Postgres and S3 object backends, on-disk layout, performance at 10,000 documents and 100,000 commits. | Engine, layout, backend design. | 014, 015 |
| R5 | Draft locking spike: lock acquisition under contention, heartbeat and expiry with a fake clock, takeover, two-tab safety, recovery. | Confirm D7 parameters. | 021 |
| R6 | Tenancy and permissions: unit tree, grants, deny, effective-permission materialisation, search filtering cost. | Permission model. | 012 |
| R7 | Comments anchoring: selector format, re-anchoring algorithm and its failure rate over real edit histories. | Anchoring design. | 022 |
| R8 | Public publishing and SSR: Fastify-hosted React render versus TanStack Start; caching; sitemap; crawlability. | SSR approach. | 023 |
| R9 | Search: PostgreSQL FTS ranking, `pg_trgm` fuzziness, snippet quality, permission join cost. | Confirm D10. | 010 |
| R10 | Provider architecture and source references: GitHub first, capability interfaces, credential storage. | Provider boundaries. | 008 |
| R11 | Embeds: Open Graph, oEmbed, sandboxing, allowlists. | Embed pipeline. | 009 |
| R12 | Operations: image, migrations, backup and restore, Helm chart, threat model. | Deployment and backup design. | 018, 024 |
| R13 | Frontend architecture and design system. | State ownership, primitives, token set. | 013, 019 |
| R14 | Interactive documents and source artifacts (lightweight; later wave). | Directive syntax and state model. | 006, 007 |

Time box: four weeks for R1 to R9 together, with R3, R4, and R5 as the critical path because they de-risk the three highest-rewrite-cost components. R10 to R14 may run into the first milestone.

---

# Part VI — Delivery plan

## 33. Build order

Each milestone lists what it delivers, what it locks in for later, and its exit criterion. Milestones are sequential for the critical path, but a second stream can start the next milestone's non-dependent work.

### M0 — Research and bootstrap

Runs the research phase and the repository constitution at the same time.

- Monorepo, package layout, Node 24, strict TypeScript, oxlint, oxfmt, test runner, coverage gates, end-to-end harness, CI running `pnpm check`, Docker Compose for Postgres and MinIO, seed data scaffold, dependency-boundary lint rules, ADR template, `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, `LICENSE`, `ARCHITECTURE`, `AGENTS`.
- Locks in: engineering standards before any product code exists.
- Exit: a contributor can clone, run one command, and see a placeholder app with a passing quality gate. ADRs 001 to 005, 010, 012 to 015, 021 to 023 accepted.

### M1 — Foundation

- Instance, organisational units, users, groups, grants, roles, and the permission resolver.
- Authentication: email and password, magic links, sessions.
- Content store package with the filesystem backend, publish path, history, diff, restore.
- Markdown package: parser, front matter with schema validation, deterministic serialiser, round-trip tests.
- Postgres schema, migrations, outbox, job runner.
- API skeleton with OpenAPI and generated client.
- Design tokens and the primitive components.
- Locks in: identity, tenancy, storage, and the API shape.
- Exit: documents can be created, published, and restored through the API with correct permissions, with no editor yet.

### M2 — Write and read

- Editor: TipTap with the mdast converter, code blocks, tables, images, attachments, links, callouts, slash commands, paste behaviours.
- Drafts, autosave, locking, presence, recovery.
- Reading view: typography, table of contents, breadcrumbs, heading anchors, light and dark, responsive, and the full-screen presentation mode.
- Document tree, navigation, move, rename, collections, tags, owners, status.
- Revisions: history, compare, restore, in the UI.
- Locks in: the editor and the reading components that SSR will reuse.
- Exit: a developer team can write and read documentation daily. Editor accessibility reviewed on all supported browsers. The acceptance question, asked of the running product and answered only by doing it through the interface: *"Can I add new workspaces, add new docs, nest them, move things around, create folders, and update documents, all in a clean and intuitive way?"* The answer has to be **yes**, and the `organise` end-to-end journey (sign in, create a workspace, create a collection, create a document and a child under it, rename both, move the child elsewhere, edit and publish, delete a document, delete the empty collection) is the proof, on all four browser profiles.

### M3 — Find, share, publish

- Search: PostgreSQL FTS with ranking, filters, snippets, permission filtering, reindex command.
- Share links with scope, role, expiry, revocation, policy, audit.
- Public publishing: public principal, publish settings, server-rendered reading pages, sitemap, metadata, public search. **Server side done** (ADR-023, `docs/architecture/public-site.md`); the publish switch and the access screen are the web half.
- Theme onboarding: logo and brand colour intake, three questions, suggested built-in theme with live preview, lever tweaks with contrast checks, save as a tenant theme (ADR-028).
- OIDC sign-in. **Done.**
- Locks in: the anonymous principal and the server-rendered path.
- Exit: a public docs site and a shared internal document both work for someone with no account.

### M4 — Comment and sync

- Comments: threads, anchoring, decorations, re-anchoring, resolve, mentions, in-app and email notifications.
- Remote Git sync: connect a repository, push on publish, pull on webhook or poll, conflict handling, admin alerts.
- Markdown folder import and ZIP export with assets.
- Operations: container image, Helm chart, backup and restore commands, upgrade guide, restore drill.
- Locks in: the outbox consumers and the sync path.
- Exit: **Release 1.** Every item in the MVP definition below is met.

### M5 — Trust

- Source references: GitHub provider, exact-revision snippets, line ranges, floating and immutable references, integration credentials.
- Source artifacts: Mermaid and Draw.io with rendered-plus-source pairing.
- Embeds: Open Graph and oEmbed, link cards, allowlists, sandboxing.
- Templates: ADR, technical design, runbook, postmortem, RFC.
- Exit: **Release 2.** An engineer can trust a snippet because it points to an exact revision.

### M6 — Maintain

- Review workflow: request review, reviewers, changes requested, approve, publish gate, comments on proposed changes.
- Documentation quality signals: staleness, ownership, broken links, orphans, missing alt text, heading structure.
- Backlinks and related documents.
- Confluence and Notion importers.
- Exit: **Release 3.**

### M7 — Operate

- Interactive documents: decisions, checklists, guided procedures, conditional content, with static export.
- Share links with comment and edit roles.
- PDF and DOCX export polish.
- Exit: **Release 4.**

### M8 — Enterprise and scale

- SAML, MFA, SCIM with group mapping to units.
- Audit log UI, webhooks, public API with tokens.
- Meilisearch adapter.
- Real-time co-editing on the draft layer with Yjs.
- Object-storage content backend at scale; separate worker deployment.
- Exit: **Release 5.**

## 34. MVP definition (Release 1)

The first public release is complete when all of the following are true for a software development team in a multi-company organisation:

- **Organise.** Units, workspaces, collections, and nested documents with inherited permissions; a private company cannot see another.
- **Write.** A polished editor with Markdown underneath, autosave, reliable locking, tables, code, images, callouts.
- **Read.** Beautiful rendering in light and dark, on desktop and mobile.
- **Version.** Every publish is a revision; history, compare, and restore need no Git knowledge.
- **Find.** Fast, permission-aware search with snippets.
- **Share.** Share links with configurable role and expiry.
- **Publish.** A collection can be made public and is crawlable.
- **Discuss.** Inline and page comments with notifications, surviving external edits.
- **Sync.** A workspace can be connected to a Git repository, and edits from either side converge.
- **Operate.** One container, Postgres, optional object storage, backup and restore commands, upgrade path, OIDC sign-in.
- **Trust the code.** Full quality gate green, full behavioural coverage on the domain, content-store, markdown, locking, and permission packages, end-to-end journeys passing on all supported browsers.

End-to-end journeys for Release 1: sign in, create workspace, create document, edit with lock contention, publish, create child, move, search, share link, make public, comment and resolve, restore revision, connect repository and round-trip an external edit, export ZIP, backup and restore.

## 35. Built now to avoid rewriting later

These are deliberately built in M0 to M2 even though their payoff comes in later milestones. Each is small; each would be expensive to retrofit.

1. **Stable document IDs in front matter** (D17). Everything references IDs, never paths.
2. **The content-store vocabulary** in section 9.1. Nothing above it knows about Git.
3. **Drafts separate from published content** (D6). Review workflow and Yjs both plug into the draft layer.
4. **Publish as a domain command.** The review gate is inserted in front of it in M6.
5. **The public principal and scope-based grants** from M1, even though nothing is public until M3.
6. **Organisational unit tree**, not fixed levels, from M1.
7. **Instance admin** distinct from workspace owner.
8. **Outbox events** from M1, with search indexing as the first consumer, so notifications, sync, and webhooks are consumers, not features.
9. **Revision hash recorded on every draft, comment, and lock**, which the merge, re-anchoring, and review features all rely on.
10. **Capability-specific provider interfaces and the provider-versus-integration split**, with credentials encrypted from the first integration.
11. **Search behind an interface** with reindex from the content store.
12. **Blob store behind an interface** with filesystem and S3 implementations. *(Built in M2: `packages/application/src/ports/blob-store.ts` and `apps/server/src/infrastructure/blob`.)*
13. **Reading components shared between the SPA and SSR**, so public publishing reuses rather than duplicates.
14. **Document status as an extensible string union** with `draft` and `published` first.
15. **Deterministic Markdown serialisation with named fidelity levels**, so Git sync does not produce noise diffs.
16. **Dependency-boundary lint rules** so layering is enforced before the codebase is large enough to argue about it.
17. **A single brand module and a rename script**, because "Quill" is a code name and the final name arrives later.
18. **The named-line layout grid as a design-system primitive**, so block widths work identically in the editor, the reading view, server rendering, and HTML export.

## 36. Success criteria

The first release passes if the following are consistently true:

- A developer would write documentation here rather than in a Markdown file and Git, and could still use Git if they wanted.
- A reader would rather read a 30-page document here than in Confluence.
- Nobody has to learn what a commit is to have full version history.
- A support engineer can find the runbook during an incident.
- An organisation can adopt GitHub today and Bitbucket tomorrow without redesigning the application.
- A new contributor can navigate the repository without an architecture lecture.
- Business logic is tested without rendering React, and every `useEffect` has a reason.

---

# Part VII — ADR index and open questions

## 37. ADR index

```text
ADR-001  Product philosophy and first users
ADR-002  Markdown as canonical document format
ADR-003  Editor architecture (ProseMirror/TipTap)
ADR-004  Internal document AST
ADR-005  Front matter schema
ADR-006  Interactive document representation
ADR-007  Source artifact model
ADR-008  Provider and integration architecture
ADR-009  Embed architecture
ADR-010  Search architecture
ADR-011  Authentication architecture
ADR-012  Tenancy and permission model
ADR-013  Frontend state architecture
ADR-014  Content store and storage backends
ADR-015  Versioning and publish semantics
ADR-016  Export and import architecture
ADR-017  Testing and coverage policy
ADR-018  Local development and deployment architecture
ADR-019  Design system and component architecture
ADR-020  Browser support policy
ADR-021  Draft and locking model
ADR-022  Comment anchoring model
ADR-023  Public publishing and server rendering
ADR-024  Backup, restore, and upgrade policy
ADR-025  Backend runtime and HTTP framework
ADR-026  Licence and naming
ADR-027  Block layout widths (breakout blocks)
ADR-028  Theming architecture
ADR-029  Template model
ADR-030  Syntax highlighting
ADR-031  Rendering and caching
ADR-032  Live blocks
ADR-033  Compatibility and regression policy
ADR-034  Configuration and data classification
ADR-035  Human-readable URLs: workspace slug plus title-slug and a ten-character instance-unique key
```

Each ADR records context, decision, alternatives considered, consequences, and status.

## 38. Open questions

Questions still without an owner-level answer. None blocks M0.

1. **Name.** "Quill" is a code name. The final name must be chosen before the first public release; the rename itself is mechanical (section 6).
2. **Public site domains.** Path-based public sites only in Release 1, or custom domains too?
3. **Attachment threshold.** Size under which images are also committed to the repository; proposed 512 KB.
4. **Lock timing.** Proposed 15-second heartbeat and 60-second expiry; confirm after the R5 spike.
5. **Required reviewers.** When the review workflow arrives, is per-document approval enough, or are required reviewers per collection needed?
6. **Email.** Is SMTP required for Release 1, or can email be optional with in-app notifications only?
7. **Telemetry.** Opt-in anonymous usage statistics, or none?
8. **Localisation.** English only for the interface in Release 1; when does UI localisation enter the plan?

---

# Appendix — Changes from the review draft

- **Restructured** 95 flat sections into seven parts. Duplicated examples (front matter, decision tree, quality signals, embed pipeline, source artifacts, ADR list) now appear once.
- **Added** a decision register, backend runtime and framework, content store design, on-disk layout, remote sync, drafts and locking, data model with collections resolved, tenancy as a unit tree, comments, share links, public publishing with SSR, operations and backups, performance budgets, licence and naming, a milestone plan with exit criteria, the MVP definition, and the "built now to avoid rewriting later" list.
- **Resolved contradictions.** Bootstrap now runs alongside research rather than after it. The MVP criteria no longer depend on features scheduled later. One ADR list replaces two. "Starred" and "Favorites" collapsed.
- **Changed** the editor from an unvalidated "Quill" selection to ProseMirror via TipTap, with the converter identified as the real work.
- **Moved** Git sync and source references earlier because the first users are software development teams. Moved comments, share links, and public publishing into the first release. Deferred review workflow and interactive documents with their extension points reserved.
- **Named** the Markdown fidelity levels instead of asking which one is required.
- **Kept** the engineering standards, React rules, and Markdown principles, condensed.
