# ADR-031: Rendering and caching

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 14, 15, 22, 31; ADR-014, ADR-015, ADR-022, ADR-023, ADR-028, ADR-030

## Context

Rendering Markdown to HTML on every request would waste work the platform has already done and make the read path slower than the budget allows. Caching the whole page, on the other hand, would freeze things that change independently of the document: who is editing it, its comments, whether its review is overdue, the code a source reference points at, the title of a document it links to. The renderer needs a clear line between what is a function of the source and what is live.

## Decision

### Three layers with different lifetimes

**1. The static body: cached indefinitely, keyed by its render input.**

The rendered body is a pure function of its **render input** — the Markdown source, and the current titles of the documents it links to — and of the renderer, so it is cached under a key of `(hash of the render input, RENDER_VERSION)` and never invalidated by events. A publish produces a new key; so does a rename in a document this one links to; the old entry simply stops being read.

The entry is therefore content-addressed and carries **no document identity**. Two documents whose render input is identical — in one workspace or in different ones — share one row legitimately, because the same bytes in give the same bytes out: a shared hit can reveal nothing that the caller's own source does not already contain. The `document_id` column records which document first produced an entry, so garbage collection can follow a deletion; nothing reads it to decide what an entry means, and nothing addresses an entry by it. The cached entry holds the HTML fragment, the outline, the extracted text for search, and the packed syntax-token ranges (ADR-030). Storage is an in-process LRU in front of a `render_cache` table in Postgres so every server instance shares it. An outbox consumer renders on `DocumentPublished`, so the first reader never pays for the render.

To stay a pure function of the source, the body must not contain anything that can change without a new revision:

- Links to other documents are emitted as canonical id URLs (`/d/<document id>`), resolved to the current path at request time and by redirect. A move or rename never invalidates the bodies that link to it.
- Dates are emitted as absolute `<time datetime>` elements; "three days ago" is the client's job.
- Theme is CSS custom properties applied at page level (ADR-028); the body carries class names only, so a theme change never touches the cache.
- Code blocks carry token ranges, not colours.
- Diagrams from source artifacts are rendered at publish and cached by the artifact's hash; they are part of the static layer because the artifact is part of the revision.

The one dependency the body has on other documents is the **display text of an auto-titled link**, and it is an *input* rather than an invalidation. The titles of the documents a body links to are resolved before the render — the canonical id URLs are found in the source in one pass, and the rows are read in one batched query — and they are part of the key. Renaming a document therefore gives every body that links to it a new key, and the next read renders once; nothing marks, sweeps, or invalidates anything, and there is no stale flag to get wrong. (Until version 2 of the renderer this was a `stale` boolean set by a `DocumentRenamed` consumer, which could never change a render because the renderer was never given the titles that made the entry stale.)

**2. The live envelope: fetched per request, never cached with the body.**

The application fetches a separate JSON envelope alongside the body, and the public site renders it server-side per request. It carries everything that is a property of now rather than of the revision:

| Element | Source of truth | Freshness |
|---|---|---|
| Presence and lock holder | lock table | polling, then server-sent events |
| Comments and their anchors | comment threads | per request; anchors re-anchored on revision change (ADR-022) |
| Permission-dependent chrome (edit, share, publish) | permission resolver | per request |
| Review due, staleness, health signals | computed from front matter dates and the quality jobs | per request, cheap arithmetic on cached data |
| Last updated, author, revision list | revisions index | per request |
| Backlinks and related documents | `document_links` | per request |
| Notes for later, interactive progress, checklist state | per-user state | per user, client-side and per-user store |

**3. External content: cached with a lifetime and a visible stamp.**

Content that comes from outside the content store cannot be a function of the revision.

- **Source references at an immutable revision** are cached indefinitely by `(integration, repository, revision, path, lines)`. They are the common case and the recommended one.
- **Source references to a branch** are fetched with a time-to-live, refreshed in the background (stale while revalidate), and always rendered with the revision they were fetched at, so a reader can see how fresh the snippet is.
- **Rich embed metadata** (Open Graph, oEmbed) is cached with a time-to-live of a day and refreshed in the background; iframe embeds are live by nature.

All three render as placeholders inside the static body and are filled from their own caches, so a slow or failing external service delays a snippet, never the document.

### Whole-page caching for the public site

Public pages are server-rendered from the cached body plus the per-request envelope. The rendered page is cached under `(revision, theme version, site settings version)` with an ETag, and served with `Cache-Control: public, s-maxage` so a CDN can hold it; a publish or a theme change produces a new key. Pages behind a session are `no-store` at the HTTP layer; only their body fragment is cached server-side.

### Presentation mode and export

Presentation mode reads the same cached body with different layout tokens. Exports render from the same body plus a snapshot of the envelope at export time, with syntax spans expanded server-side (ADR-030).

## Alternatives considered

- **Render on every request.** Simple, but a 30-page document with tables and code costs tens of milliseconds per read and repeats work that is identical for every reader.
- **Cache the whole page for signed-in readers.** Rejected: presence, comments, permissions, and staleness would go stale, and per-viewer variation would explode the key space.
- **Time-based invalidation of the body.** Rejected: the body has no time dependence once links, dates, and theme are kept out of it; content-keyed entries are simpler and never wrong.

## Consequences

- The renderer in `packages/markdown` must emit id links, absolute times, class names, and token ranges, and never titles, relative dates, colours, or per-viewer data. That is testable and is part of its contract.
- `RENDER_VERSION` is bumped when the renderer's output changes; old entries are garbage-collected by age of last read, not by event. It stands at **2**: version 1 bodies predate the packed syntax-token ranges the client applies and predate the link titles entering the key, so they are readable — every version ever shipped stays readable (ADR-033) — but are never served. A reader that meets one gets a fresh render rather than a body known to be wrong, and no one has to truncate a table by hand.
- The `render_cache` table and the render-on-publish consumer are built with the reading view in M2; there is no invalidation consumer beside it. Branch-reference and embed caches arrive with those features in M5.
- `GET /documents/:id/rendered` sends the cache key as its `ETag`, because the key is the whole of the body's identity. A tag of the revision alone would not change when a document this one links to is renamed, and a reader holding it would be told nothing had changed when the body had.
- The `stale` column stays in the table until the contract step that follows this release (ADR-033): migrations expand first and remove later.
