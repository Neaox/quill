# @quill/search

The search core (ADR-010, quill-plan.md §15): everything a search engine
adapter needs that has nothing to do with which engine it is. PostgreSQL
full-text search is the first adapter; Meilisearch or a semantic index are
later ones, sharing this package rather than duplicating it.

## What the core owns

- **Query language** (`query/`) — `parseQuery` turns free text into a
  structured `SearchQuery`: free terms, quoted `"phrases"`, `-exclusions`,
  and field filters (`title:`, `tag:`, `owner:`, `status:`, `collection:`,
  `in:workspace`). It returns a `Result`, so a malformed query (an
  unterminated quote, an empty filter value) is reported with the character
  position of the problem rather than thrown. `serializeQuery` renders a
  `SearchQuery` back to text; the two round-trip (`parse.property.test.ts`).
- **Indexable document projection** (`document/`) — `projectIndexableDocument`
  turns a published document's front matter, outline, and text (via
  `@quill/markdown`'s own `extractText`/`extractOutline`) into an
  `IndexableDocument`: id, workspace, collection, path, title, headings
  weighted by depth, body, tags, owners, status, and `updatedAt`. The shape
  carries a version (rule 17); `assertSupportedIndexableDocumentVersion` is
  where a reader refuses one it has never shipped.
- **Ranking, as data** (`ranking/`) — `RankingProfile` holds field weights
  (title over headings over body), a recency-decay curve, an exact-phrase
  boost, and workspace-affinity settings. `DEFAULT_RANKING_PROFILE` is the
  one place the defaults live, pinned by a test; an adapter translates the
  profile into its own engine's scoring (a `tsvector` weight letter, a
  Meilisearch ranking rule) rather than inventing its own notion of what
  matters more.
- **Snippets** (`snippet/`) — `buildSnippet` finds a document's matches and
  returns a sentence-trimmed window of body text plus `{ start, end }`
  offsets into it — never HTML. A caller renders the offsets however its
  surface needs to.
- **The permission-filter contract** (`visibility/`) — `VisibilityFilter`
  names every workspace a principal set may read (search crosses workspaces,
  so this is a set, not the one the caller is currently in) and the
  principals themselves. `SearchRequest` (`service/search-request.ts`) makes
  it a required field, so a request cannot be built without saying who is
  searching and where they may look; an adapter applies it *inside* the
  index query, never as a filter over already-fetched results.
- **The composed service** (`service/`) — `createSearchService(index,
  profile?)` wires parse → the engine's `search` (which applies the
  visibility filter and the ranking profile, including the current
  workspace for `RankingProfile.workspaceAffinity`'s boost) → a snippet
  built from each hit's own body → `groupByWorkspaceAffinity`, which splits
  the result into `current` (matches in `SearchRequest.currentWorkspaceId`)
  and `elsewhere` (every other matching workspace, grouped and ordered by
  its best hit) — quill-plan.md §15: a match in the caller's current
  workspace first, everything else offered as grouped suggestions, since
  search is the one surface that crosses workspaces. `test-support/` has an
  in-memory `SearchIndex` for exercising this composition without a real
  engine.

## What an adapter owns

Everything engine-specific: the actual storage and query execution, turning
a `RankingProfile` into real scoring, turning `VisibilityFilter` into a join
against the materialised permission table (ADR-012), and applying
`SearchIndex.remove`/`index` to keep the store in sync with
`DocumentPublished` outbox events. An adapter lives outside this package
(the PostgreSQL adapter is expected in `apps/server`'s infrastructure, per
`ARCHITECTURE.md`'s layering table) and implements `SearchIndex`
(`service/search-index.ts`).

## `SearchIndex` here versus `@quill/application`'s port

This package deliberately does not depend on `@quill/application` — only on
`@quill/domain` and `@quill/markdown`, so the query language, ranking data,
snippet builder, and visibility contract can be tested without pulling in
the application layer. That means `service/search-index.ts` declares its
*own* `SearchIndex` interface, richer than
`packages/application/src/ports/search-index.ts`'s: it takes the parsed
`SearchQuery`, the mandatory `VisibilityFilter`, and the full
`RankingProfile`, and returns hits that still carry their body text so a
snippet can be built from the real match.

The two are not yet the same interface, and a server-side adapter bridging
them today would lose information in both directions:

- `@quill/application`'s `IndexableDocument` has no `collectionId`, `path`,
  per-heading weight, `owners`, or `status` — an adapter would have nowhere
  to put what `projectIndexableDocument` produces.
- `@quill/application`'s `SearchQuery` takes one optional `workspaceId`, not
  the set `VisibilityFilter.workspaceIds` carries — it cannot express "every
  workspace this caller may read", which is what makes the cross-workspace
  ranking quill-plan.md §15 describes possible in the first place. It also
  has no room for the `title:`/`owner:`/`status:`/`collection:` filters this
  package parses, for an exclusion, or for a `RankingProfile` (workspace
  affinity included) to travel to the adapter's scoring.
- `@quill/application`'s `SearchResult.snippet` is already a rendered HTML
  string; there is nowhere for the raw body text or match offsets
  `buildSnippet` needs, so the port's shape assumes the adapter builds its
  own snippet rather than reusing this package's.
- `@quill/application`'s `SearchPrincipal` (`{ principalIds }`) already
  matches `VisibilityFilter.principalKeys` well; no change needed there.

(The method is also named `search` here, not `query` as ADR-010's interface
sketch shows, because it returns already-scored hits rather than a bag of
results to score — a naming choice, not a contradiction of the decision:
both interfaces route every search through `packages/search`, and
application code still never writes SQL.)

No adapter implements `@quill/application`'s `SearchIndex` yet, so widening
it is low-risk. Reconciling the two — most likely by growing the
application port additively to match this package's shapes, since ADR-033
requires API changes within a version to be additive — is future work for
whoever builds the first adapter, tracked here rather than guessed at.
