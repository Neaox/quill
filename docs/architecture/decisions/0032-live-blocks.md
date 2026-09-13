# ADR-032: Live blocks

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 16, 20, 21, 22; ADR-002, ADR-006, ADR-008, ADR-009, ADR-031

## Context

Some parts of a document change on a different cadence from the document itself: a code snippet that follows a branch, an embed's preview, a list of documents matching a tag, a query result, the status of a service or a deployment. ADR-031 keeps the rendered body a pure function of the source, so these cannot live in the body. They also must not turn documents into programs: MDX-style arbitrary components would break the portability rule of ADR-002 and make every document a code-execution surface.

## Decision

### A live block is a declarative directive with a bounded type

Authors write a directive from a registry of **live block types**; they never write code. Examples:

```markdown
::source{integration=corporate-github repo=platform/payments ref=main path=src/config.ts lines=42-71}

::documents{tag=runbook status=published sort=updated limit=10}

::status{integration=deploys service=payments-api refresh=30s}

::query{artifact=weekly-latency.sql refresh=1h}
```

Each type is registered on the server (built in, or later by an integration) with:

- a **name** and an attribute **schema** (TypeBox) that validates the directive at parse time;
- a **fetcher** that produces a snapshot from its parameters, running with the integration's credentials on the server, never the reader's;
- a **cadence**: `on-view` with a time-to-live (stale while revalidate), `scheduled` (refreshed by the job runner), or `push` (refreshed by a webhook or outbox event); the type sets the minimum, the author may set `refresh=` no shorter than that;
- a **static renderer** that turns a snapshot into semantic HTML with an "as of" timestamp, used for exports, crawlers, and readers without JavaScript;
- an **island** component in `apps/web` that hydrates the block, subscribes to updates at the block's cadence, and renders the live state.

Outside Quill the directive degrades to its readable form (ADR-002): a link to the source, the query text, the parameters.

### How it fits the caching model

- The static body (ADR-031) renders a live block as a **slot**: a `section` carrying the block's type, its validated parameters, and a stable key derived from them, with the directive's readable fallback inside. The body stays a pure function of the source.
- **Snapshots** live in a `live_snapshots` table keyed by that key, shared across every document that uses the same block with the same parameters, each with its fetched-at time and the cadence that governs it.
- **Page assembly** fills each slot from the snapshot store per request, in one pass, and lists the slot keys in the live envelope. A missing or expired snapshot is rendered as its fallback while a refresh is queued; a failing source shows the last good snapshot with its age, never an empty block and never an error that blocks the document.
- On the client, the app hydrates each slot into its island. `on-view` blocks poll at their cadence while visible; `push` and `scheduled` blocks receive updates over server-sent events keyed by slot key.

### Permissions and privacy

- A live block's data is visible to whoever can read the document, so a block may only reference integrations the document's workspace has been granted, and the snapshot is shared by design.
- **Viewer-scoped** blocks (anything that depends on who is reading, such as "your open review requests") are a separate category: they render client-side only from per-user data, are never snapshotted, and are omitted from exports with a note. Interactive user state (ADR-006) is the same category.
- Live blocks display data; they never perform external actions. That remains the rule from ADR-006 for interactive blocks.

### What this is not

- **Not MDX.** No JSX, no imports, no expressions in documents. The set of block types is a registry, and a new type is a server-side registration with a schema, a fetcher, and a renderer, not code in a document.
- **Not a plugin system for authors.** Tenants get new block types from built-ins and from integrations. A general extension API for third parties is a later decision and would still register types the same way.

### Delivery

- M2: the renderer emits slots for any registered live directive and the fallback for unknown ones; the slot key and envelope plumbing are part of the reading view. The fallback is a `section` carrying the block's type in `data-live-block` and, inside it, the directive's readable source form — its name and its parameters, as text. A leaf directive nothing has registered therefore never renders as nothing: an empty render would delete a line of the author's document, which is the opposite of degrading.
- M5: the registry, snapshot store, refresh cadences, server-sent events, and the first block types, source references (immutable and branch), embeds, and document lists.
- Later: query results from SQL source artifacts and integration-provided status blocks.

## Alternatives considered

- **MDX or embedded components.** Rejected: not readable outside Quill, an execution surface inside documents, and unexportable.
- **Rendering live content into the cached body with invalidation.** Rejected: it would tie the body's cache to every external source's cadence and make ADR-031 false.
- **Client-only fetching with no snapshots.** Rejected: exports and crawlers would get nothing, and every reader would hit the external source.

## Consequences

- A live block type is a small contract in one place: schema, fetcher, cadence, static renderer, island. Adding one never touches the renderer or the cache.
- The snapshot store is another outbox consumer and another job, on infrastructure the platform already has.
- Authors get the "live section" capability with one line of Markdown that still reads sensibly in a Git diff.
