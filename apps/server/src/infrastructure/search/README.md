# The PostgreSQL search adapter

The first engine behind the `SearchIndex` port (ADR-010, quill-plan.md §15),
and the one a self-hoster gets without running a second service.
`packages/search` owns everything that is not about which engine this is — the
query language, the projection, the ranking profile, snippets, the
workspace-affinity grouping — and this owns the rest.

| File | What it owns |
| --- | --- |
| `postgres-search-index.ts` | The `SearchIndex` implementation: the upsert, the delete, and the query that filters, scores, pages, and picks a snippet window. |
| `query-sql.ts` | A parsed `SearchQuery` as `tsquery`s and predicates. No user text is ever concatenated into SQL. |
| `index-entry.ts` | An `IndexableDocument` as a `document_search` row. |
| `index-document.ts` | Projecting one published document into the index, or taking it out. Shared by the outbox consumers and `quill reindex`. |
| `visible-documents.ts` | Turning a `VisibilityFilter` into what the query may look at (ADR-012). |
| `cursor.ts` | The opaque keyset cursor a page hands back. |

## Permission filtering happens inside the query

This is the part to read first, because it is the part that must not be wrong.

`VisibilityFilter` names the workspaces a caller may read and the principals
they hold. `visible-documents.ts` turns that into either "everything in these
workspaces" (an instance administrator, who bypasses resolution by ADR-012) or
a pair: the workspaces the caller may read *whole*, and the individual
documents they may read in the workspaces where that is not true of all of
them. Both come from `visibleDocumentIds`, the same call the workspace's own
document list makes, which materialises the effective-permission rows with the
domain's `materialiseEffectivePermissions` and combines them with the one
`combineContributions` that `resolvePermission` also ends in. ADR-012's
amendment exists because a second implementation of that rule drifted from the
first; there is not a second one here.

That answer is then a `WHERE` clause. Nothing is fetched and discarded: a
document the caller cannot read is never scored, never counted, never included
in a total, and never paged past. The adapter's integration test asserts it
directly — a denied document whose title matches the query exactly does not
appear.

Three things keep it affordable:

- **A workspace the caller may read whole is named, not enumerated.** The
  ordinary case is a grant at the workspace and no document-scope deny below
  it, so the query says `workspace_id = ANY(...)` and no document id travels
  at all.
- **A bounded number of workspaces per request** (`WORKSPACES_PER_BATCH`). The
  workspace the caller is in is resolved first and always; the rest follow in
  a stable order, and the search cursor carries where to resume. A member of
  forty workspaces pays for five permission walks, not forty — and sees the
  rest on the pages after, not never.
- **Serially, not all at once.** One walk at a time leaves the connection pool
  for the requests that are not searching.

Nothing is cached. A permission cache that went stale would show somebody a
document that had just been taken away from them, which is a disclosure rather
than a slow query. The materialised effective-permission table (ADR-012,
ADR-034) is the real answer and is scheduled with the events it needs in
quill-plan.md §15; when it exists the resolver becomes a join inside this same
SQL and nothing else changes, because the seam is in `visible-documents.ts`
rather than in the query.

## The match: AND first, OR when that finds too little

Every word the author typed has to appear. That is precise, and it is what
somebody who typed three words usually meant.

When the AND-ed query returns fewer than `WIDEN_BELOW_HITS` (20 — one
screenful) documents, the search runs again with the words ORed and that
second answer is the one returned. An almost-empty page is worth trading for
near misses; a full one is not. The first query over-fetches to that threshold
so "fewer than a screenful" is an answer rather than a guess.

The widening is skipped when there is only one positive clause (the two arms
are then the same query), when the author quoted a phrase (an exact demand),
and when a cursor already says which arm this page-through is on — switching
arms half way down a list would reorder the list being paged, so the cursor
carries the arm.

## Typo tolerance is a separate arm

`pg_trgm` answers "which titles look like what was typed". It is unioned in as
its own `SELECT` rather than ORed into the full-text predicate, because a
disjunction of a `tsvector` match and a trigram match can use neither index;
as two arms, each uses the index built for it. `EXPLAIN` over the 50,000
document corpus (`pnpm --filter @quill/server bench:search -- --explain`)
shows exactly that: a bitmap index scan on `document_search_vector_idx` for
one arm and on `document_search_title_trgm_idx` for the other, both
intersected with `document_search_workspace_idx`.

The `%` operator is the indexable one and reads its threshold from a session
setting, so the trigram arm runs inside a transaction that sets it locally;
`similarity()` appears only in the score, where an index is not the question.
The full-text-only path — nearly every search — is one statement with no
transaction around it.

Typo tolerance never runs beside a quoted phrase. A phrase is an exact demand,
and a document that does not contain it must not be offered however alike its
title looks.

Whether `pg_trgm` is usable at all is probed once and remembered for the
lifetime of the process: an extension is not installed and uninstalled under a
running server. A probe that *fails* is not remembered, so a database that was
briefly unreachable is asked again rather than being written off.

## Ranking is the profile, translated

`RankingProfile` is data (`@quill/search`), and this turns it into scoring:

- **Field weights** become `ts_rank_cd`'s `{D, C, B, A}` array against the
  single generated `tsvector` the schema builds from title (A), headings (B)
  and body (C). Normalisation 32 (`rank / (rank + 1)`) keeps a score between 0
  and 1 so pages compare cleanly.
- **Heading depth** becomes term frequency: `index-entry.ts` repeats each
  heading by its `headingWeight`, because a `tsvector` has one weight letter
  per column and all headings share B.
- **Recency** becomes the same halving curve `recencyMultiplier` computes in
  TypeScript, evaluated against the instant the *first* page was scored at —
  carried in the cursor, so page two scores identically.
- **An exact phrase** and **the current workspace** are multipliers. The
  workspace boost is applied before the cutoff, not after:
  `groupByWorkspaceAffinity` can only order what came back.
- **Trigram similarity** is *added*, not multiplied, because a document the
  full-text query did not match has a relevance of zero and would otherwise
  stay at zero however close its title is.

## Snippets are the core's

`ts_headline` chooses *which* part of a long body is worth showing. It is the
one thing that knows where the query actually landed, stemming included, and
it is asked for a single fragment with `StartSel` and `StopSel` empty, so what
comes back is plain text and not markup. `createSearchService` then runs
`buildSnippet` over that window: it trims to a sentence and returns `{ start,
end }` offsets for the query's words found *literally* in the window.

The two do not always agree, and the disagreement is deliberate. A document
matched only after stemming gives a window with the right text and no ranges
to mark — the excerpt is still the right excerpt, and nothing is highlighted
rather than the wrong thing being highlighted. A query that matched the title
and nothing in the body gets the opening of the document, which is what a
reader wants to see anyway. The server never emits highlighting HTML.

## Keeping the index current

`createIndexOnPublishConsumer` and `createIndexOnRenameConsumer`
(`../outbox/index-on-publish.ts`) both run `indexDocument`, which is also what
`quill reindex` (`../../scripts/reindex.ts`) runs over everything — so a
rebuilt index is the same index. All of it is idempotent, which at-least-once
delivery requires: indexing is an upsert, and a document that turns out to be
gone or unpublished is removed rather than failing the event for ever.

Each row records the revision it was projected from (ADR-034). The revision
travels on the `IndexableDocument` rather than being read from the document's
row as the entry is written, because by then the head may already be a later
publish and the row would claim a revision it does not hold.

A generated `tsvector` may not exceed a megabyte, and a pathologically
token-dense document can reach it. PostgreSQL answers `54000`, and `index`
retries with the body cut to `MAX_INDEXED_BODY_BYTES` — a document findable by
its title and most of its body beats an event that fails until it dead-letters
and a document nobody can find.

There is no `DocumentDeleted` consumer. `document_search.document_id` is a
cascading foreign key onto `documents`, so deleting a document removes its
entry in the transaction that deleted it — an event afterwards would be a
second, slower way to reach a state the database already guarantees.

## Measuring it

`pnpm --filter @quill/server bench:search` builds a corpus of 50,000 documents
across 20 workspaces, two of them readable, in a schema of its own and leaves
it there, then reports the median of five runs per query against the 300 ms
budget in quill-plan.md §31. `--reseed` rebuilds the corpus; `--explain`
prints the plan for the candidate query instead of timing it.

As it stands, on that corpus: `database failover runbook` 137–180 ms, a
single term 90–97 ms, a quoted phrase 83–102 ms, a misspelled query
119–157 ms, and a bare `tag:` filter 50–76 ms — against a budget of 300 ms.
