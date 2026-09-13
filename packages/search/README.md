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
a `RankingProfile` into real scoring, turning `VisibilityFilter` into a
restriction applied inside the engine's own query (ADR-012), and applying
`SearchIndex.remove`/`index` to keep the store in step with
`DocumentPublished` outbox events. An adapter lives outside this package:
the PostgreSQL one is `apps/server/src/infrastructure/search`, per
`ARCHITECTURE.md`'s layering table, and its README explains how it answers
each of those.

## One port, declared with the other ports

There is one `SearchIndex` in the platform, and it is declared in
`packages/application/src/ports/search-index.ts`, beside the content store
and the blob store, because a port belongs to the layer that depends on it
(`ARCHITECTURE.md`: the application layer may depend on "the interfaces it
declares"). This package re-exports it, together with `SearchQuery`,
`IndexableDocument`, `RankingProfile`, and `VisibilityFilter`, so an adapter
implements one interface and two shapes can no longer drift apart.

Every *value* stays here: `parseQuery`, `serializeQuery`,
`projectIndexableDocument`, `headingWeight`,
`assertSupportedIndexableDocumentVersion`, `DEFAULT_RANKING_PROFILE`,
`recencyMultiplier`, `buildSnippet`, `visibilityFilter`,
`groupByWorkspaceAffinity`, and `createSearchService`. The imports from
`@quill/application` are type-only and therefore erased, so this package
still pulls in nothing of the application layer at runtime and its tests
still run without standing one up.

Reconciling the two widened the port rather than narrowing this package, as
the note that used to stand here proposed: it was the application port that
had no `collectionId`, `path`, per-heading weight, `owners`, or `status` on
an indexed document; that took one optional `workspaceId` instead of the set
of workspaces a caller may read, with no room for field filters, exclusions,
or a ranking profile; and that returned a pre-rendered HTML snippet where
`buildSnippet` needs the matched body text to compute offsets from. Nothing
implemented it, so nothing had to change to meet the wider shape.

(The method is named `search`, not `query` as ADR-010's interface sketch
shows, because it returns already-scored hits rather than a bag of results
to score — a naming choice, not a contradiction of the decision: every
search still routes through this package, and application code still never
writes SQL.)
