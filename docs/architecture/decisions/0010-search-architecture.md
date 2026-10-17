# ADR-010: Search architecture

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 15; ADR-012; decision D10; research R9

## Context

Search must be fast, permission-aware, and available to self-hosters without extra services, while leaving room for a dedicated engine or semantic search later.

## Decision

- The first implementation is PostgreSQL full-text search: weighted `tsvector` columns (title A, headings B, body C), `pg_trgm` for fuzzy matching and typo tolerance, `ts_headline` for snippets.
- All search goes through a `SearchIndex` interface (`index`, `remove`, `query`) in `packages/search`. Application code never writes SQL for search.
- Permission filtering joins a materialised effective-permission table (ADR-012). Results never reveal titles the principal cannot read. Public search is scoped to public content and rate limited.
- Indexing is driven by `DocumentPublished` outbox events. A reindex command rebuilds the index from the content store.
- Meilisearch, Typesense, or a semantic index are later implementations of the same interface.

## Alternatives considered

- **Meilisearch from the start.** Rejected: an extra service for every self-hoster before the ranking requirements are known.
- **Search inside the application without an interface.** Rejected: guarantees a rewrite when the engine changes.

## Consequences

- R9 measures ranking quality and query latency against the performance budget (300 ms at 50,000 documents) and may adjust weights, not the architecture.

## Amendment, 2026-10-17: finding what somebody has published (`by:` and `team:`)

People look for a page by who wrote it as often as by what it says ("Sam wrote the pricing doc, I can't remember its name"; "what has Platform written about on-call?"). The query language gains two filters, `by:` and `team:`, and the index learns who has published each document.

**Who.** A document's *contributors* are everyone who has published a revision of it, as the revisions recorded them: a name and an address. They come from the revisions index (`RevisionsIndexRepository.listContributors`), once each, by lower-case address, under the name last used. The address is the identity because it is stable where a display name is edited and spelt differently in different tools. They are not accounts: a revision that arrived through Git sync names someone who may never have had one, and is still findable. `IndexableDocument` is version 2; version 1 is still read (rule 17), and the migration fills every existing row from the revisions, so nobody has to run `quill reindex` for the filters to work on what is already indexed.

**How it is stored.** Two columns on `document_search`: `contributor_emails text[]` (GIN) for exact matching, and `contributors_text` (one lower-case line per person, name then address, trigram-indexed where the extension is available) for matching part of a name. A line each, so a needle cannot run from one person into the next.

**How it is asked.** `by:me` is the account the request is made as, read from the user principals in the visibility filter. A value with an `@` is an address, matched exactly. Anything else is part of a name or an address, matched as plain text; `%` and `_` are escaped and the value is a bound parameter. `team:` is a group by name with the groups nested inside it, or a unit by name or slug with all of its groups, and finds what any member has published.

**Teams are resolved when the search runs.** Nothing about a team is stored in the index. A person joining or leaving a team, or a group being renamed, takes effect on the next search with no reindex and no event, and a name that matches nothing is an empty set of people and so matches no document, never every one. This follows the precedent `collection:` and `in:` set: the engine resolves a name against the tables it shares a database with, inside the query.

**Privacy.** Both filters narrow inside the same permission filter as every other clause, so they never widen what the caller may read. They are not answered on the public site: `by:somebody@company.com` would confirm to a stranger that an address wrote a published page, so `/s/<site>/search` says it is not offered and does not ask the engine.

## Alternatives considered (people and teams)

- **Store a document's teams in the index.** Rejected: membership changes would have to be events that reindex every document an affected person touched, to save a join over a table that is small and indexed.
- **A people-resolver service between the query and the engine.** Rejected: a second place that knows what a name means, and a hop to cover a join. `collection:` and `in:` already resolve in SQL.
- **Index user ids.** Rejected for now: revisions record a name and an address, not an account, so ids would lose the Git-synced authors and every revision written before ids were recorded. The address is the key that exists for all of them.

## Consequences (people and teams)

- A person who changes their address stops matching what they published under the old one until revisions are rewritten; searching by name still finds them.
- `by:` over a name is a substring match, so a short value matches many people. That is the same trade a typeahead makes, and the result is still only what the caller may read.

## Amendment, 2026-10-17: richer results and filter suggestions

A result row shows more than a title and a snippet, and the search box completes the value of a filter as it is typed.

**Richer hits.** A hit now also carries the document's `status` and `updatedAt` (from the document row the route already loads), its first five `tags` (from the index row the hit was read from, which is why `SearchHit` gains `tags`), and its `contributors` (at most three names, most recent publisher first) with a `contributorCount`. The contributors come from one new batch query on the revisions index, `listContributorsForDocuments`, so a page costs one query however many hits it has. They are names only: the response never carries an address.

**Suggestions.** `GET /api/search/suggestions?field=&prefix=` completes `by:`, `team:`, `tag:`, `collection:`, `in:` and `status:`. The rule is the one the rest of this ADR sets: a suggestion is a search result with the document left off, drawn from what the caller may read.

- `by` and `tag` are answered by the engine, through a new `SearchIndex.suggest` that takes the same `VisibilityFilter` as `search` and applies it inside the query, using the same visible-documents resolver. A name or a tag that appears only on a document the caller is denied is never selected. People are the display names of *accounts* whose address is among the contributors of a document the caller may read: the join to accounts is what keeps a Git-synced author with no account, and every address, out of the answer.
- `team` is a unit or a group by name, restricted to the units that are the unit of a workspace the caller may read, or an ancestor of one. Units are private to one another (ADR-012), so a stranger cannot use the box to enumerate the organisation's structure. `collection` and `in` are the collections and workspaces the caller may read, from the same lists the navigation uses; `status` is the fixed set of statuses.
- Relevance is one function for every source (`rankSuggestions`): labels that start with what was typed, then labels that contain it, alphabetical within each, case-insensitive, de-duplicated. The route shares the search rate-limit bucket and is not audited, for the reasons search is not.

The orchestration is an application service (`suggestSearchValues`), so the route stays thin and the rule is testable without HTTP.

**Consequences.** `SearchIndex` gains a method, so every engine adapter implements it. Suggestions for `by` and `tag` walk permission batches like a search and stop once the limit is filled, which means a later batch's values can rank below ones already found; the cost per keystroke stays bounded.

## Amendment, 2026-10-17: hierarchical tags, properties and facets

Three things so that people can narrow a search without remembering how a document was written: tags become a hierarchy, any front-matter key can be asked about on purpose, and a search can say what its results contain so they can be refined.

**Tags are hierarchical, with `/` as the separator.** `area/billing` is a child of `area`. `tag:area` finds a document tagged `area` or anything beneath it; `tag:area/billing` finds only that subtree. A tag is read in one place, `normaliseTag` and `expandTagPaths` in `@quill/search`: lower case, space trimmed from the tag and from each segment, empty segments dropped (`a//b` is `a/b`, `/a/` is `a`), and a tag that is only separators is no tag. The projection, the PostgreSQL adapter and the in-memory double all call it; nothing else re-implements it. `document_search.tag_paths` (GIN) holds every tag and every ancestor of every tag, so `tag:` is `tag_paths @> ARRAY[<normalised value>]` and is served by the index; `tags` keeps the tags as written (folded) for display. A value that is no tag matches no document. The tag paths are derived from `tags`, so `IndexableDocument` carries nothing new for them, and migration 0017 fills existing rows from `tags` in SQL: `tag_paths` is correct on upgrade (the migration test runs that statement over every seeded row and compares it to `expandTagPaths`). `tag:` suggestions offer every node of the hierarchy (`area` beside `area/billing`), from the same permission-filtered query as before, ranked by `rankSuggestions`.

**Properties: the front-matter keys that are not core fields.** Keys that are not core fields (everything `CoreFrontMatterSchema` does not name) are not searchable by default and are never offered in suggestions or facets. They are searchable only explicitly, with `prop:key=value`: the value is split at the first `=`, key and value are trimmed and lower-cased, and a filter with no `=`, an empty key or an empty value matches nothing, never everything. `IndexableDocument` is **version 3** and gains `properties: Record<string, string[]>`, computed by `extractProperties` from the whole front matter (rule 7: unknown keys survive into the projection): scalars (strings, finite numbers, booleans) and arrays of scalars only, with objects, nulls and nested arrays dropped; keys at most 64 characters and values at most 200 (dropped, not cut), at most 20 values per key and 30 keys per document, the extras dropped deterministically (the first 20 values in written order, the first 30 keys in code-point order). Stored in `document_search.properties jsonb` (GIN, `jsonb_path_ops`) and asked by containment, `properties @> jsonb_build_object(key, jsonb_build_array(value))`, with key and value as bound parameters. Versions 1 and 2 are still read (rule 17).

*Backfill.* A property lives in the content store, not in the index, so no migration can derive it: existing rows hold `{}` until their document is next published or `quill reindex` runs, and `prop:` finds nothing on them until then. `index_version` is left as it was on those rows, so they still say they have not been re-projected. Everything else in this amendment works on upgrade.

*Declarations.* A later layer of workspace property declarations (typed, searchable by their own key, such as `severity:high`) maps a declared key onto this index: a declaration says which key and which type, and the index already holds the values.

*Privacy.* `prop:` is for signed-in callers only, like `by:` and `team:`. The public site refuses it exactly as it refuses them (the page says searching by person, team or property is not offered, and the engine is not asked): otherwise a stranger could probe front matter the site never shows.

**Facets.** `GET /api/search` takes `facets`, a comma-separated subset of `tag,status,collection` (anything else is a `400`), and answers `facets` beside the results: for each, the top 8 values by count, then by label in code-point order, each `{ value, label, count }`. `value` is what goes after the filter key (`tag:<path>`, `status:<status>`, `collection:<name>`), `label` is the text to show.

- *Counts are over the whole set the query matches and the caller may read*, not the page. The permission filter is applied inside the same statement as the match, over the same batches of workspaces a search walks (all of them: counting cannot stop early), so a denied document never contributes to any count. A hierarchical tag counts its descendants.
- *Counts reflect the query as asked, including all its filters*, so they answer "what is in these results". A value the query already filters on is still returned; the web hides it.
- *The match is the strict one.* The engine counts the AND of every word, with the same typo arm the search's AND arm has, and never the OR widening that `search` falls back on when fewer than a screenful match. Counts therefore equal the number of results that paging a search to the end shows whenever the search did not widen, and a refinement's count is the number of results that refinement gives. When the search did widen (a half-remembered phrase finding near misses), the facets describe the exact matches only; counting a set whose size depends on a per-batch heuristic would make a count unreproducible.
- *Collections are counted by name.* The engine counts collections by id (it does not know names); the route names them with one batched lookup, and collections that share a name (in different workspaces) are one value, because `collection:` matches by name and a count should be what the refinement returns.
- `SearchIndex` gains `facets(query, filter, options)`. It takes no ranking profile (counting has no ranking), and `collection` is returned whole so the route can merge before it takes the top values. The method is part of the port, so every engine adapter implements it.
- Absent `facets`, nothing is counted and nothing extra is queried.

*Cost, measured* (`pnpm --filter @quill/server bench:search`, 50,000 documents in 20 workspaces, the caller reads two of them, on a heavily loaded developer machine): `facets=tag,status,collection` took a median of 109 to 149 ms for queries matching 625 to 5,000 documents, and 247 ms for a text query matching the whole readable set through the typo arm (`runbook`; its page took 565 ms in the same run). That is above 100 ms, and about the cost of the page of the same query. The statement itself is 15 to 50 ms; the rest is the permission walk (about 26 ms, done once by the search and once more by the facets) and the trigram arm. The route runs the page and the facets concurrently, so the wall-clock cost is less than the sum, but the load on the database is doubled. The cheapest mitigation, not applied: resolve the visible documents once per request and share them between the page and the facets (about 26 ms and one fewer round trip); beyond that, ask for facets only on the first page and lazily (when the filter panel opens). Correctness is not capped anywhere.

*Follow-up, 2026-10-17: the visibility is resolved once per request.* The mitigation above is applied. `SharedVisibility` (a small handle holding the caller's `VisibilityFilter`, made by `shareVisibility`) is passed as `visibility` in the options of both `search` and `facets`, and `currentWorkspaceId` is now a `facets` option too, so both walk workspaces in the same order. `PostgresSearchIndex` keeps what each batch resolved to against the handle (the in-flight promise, so the page and the facets running together wait on one walk), in a `WeakMap`: it lives as long as the request and is never a cache across requests, so a changed permission is seen by the next one. A handle is used only for the filter it was made for; offered with another caller's filter it is ignored and the index resolves afresh, so it can neither widen nor narrow anyone's visibility. Without a handle behaviour is exactly as before. The route builds one handle per request and the response is unchanged. Measured on the same corpus (median of five, loaded machine, three runs): the walk for a member of two workspaces is 35 to 63 ms, and page plus facets asked together went from 89 to 209 ms unshared to 70 to 156 ms shared for queries matching 625 to 5,000 documents, a saving of about one walk (15 to 60 ms). A query that matches the whole readable set through the typo arm (`runbook`) is bounded by the page statement itself (about 280 to 420 ms) and gains nothing measurable.

**Alternatives considered (tags, properties and facets).**

- *Store only `tags` and expand at query time* (`tag LIKE 'area/%'`). Rejected: not indexable, and it makes `area` match `area/billing` by a pattern rather than by a fact.
- *Make every front-matter key searchable by its own name.* Rejected: front matter is open (ADR-005), so such filters would collide with core keys and with each other, and suggestions would leak whatever keys authors invented. `prop:` is explicit; declarations add names deliberately.
- *Facet counts that include the OR widening.* Rejected, as above.
- *Count in the application over fetched hits.* Rejected: it would count only a page, and fetching everything to count it is the N+1 of search.

**Consequences (tags, properties and facets).** `SearchIndex` gains a method; `IndexableDocument` is version 3; `tag:` is now containment over paths, so a tag written with surrounding space or doubled separators is the tag it normalises to. A row's properties appear after its next publish or `quill reindex`. Facet values cost one more statement per batch of workspaces when asked for.
