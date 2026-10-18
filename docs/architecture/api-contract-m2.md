# M2 content API contract

The routes the reading view, the editor, and the publish flow use. The server implements these with TypeBox schemas so the OpenAPI description and the generated client match this document exactly; if the two disagree, the server's schema wins and this document is corrected.

All routes are under `/api`, require a session unless stated, and use the error shape `{ error: { code, message, details? } }`. A request the framework refuses before any route runs keeps its own 4xx, with the status's standard phrase as the message and a stable code: `invalid_body` (malformed or empty JSON, a bad `Content-Length`), `payload_too_large` (413), `unsupported_media_type` (415), `method_not_allowed`, `not_acceptable`, `request_timeout`, `uri_too_long`, `request_header_fields_too_large`, and `bad_request` for any other. Only a fault of the server's is a `500 internal_error`. Ids are UUIDs. Revisions are 40-character hex strings and are never called commits.

**Readable references (ADR-035).** Everywhere a route takes a document id it also takes that document's short key — ten Crockford base-32 characters, unique across the instance — with or without the title words in front of it: `/api/documents/<uuid>`, `/api/documents/k7m3q9v2xd`, and `/api/documents/authentication-architecture-k7m3q9v2xd` are the same request. The words are advisory and never consulted, so a stale title in a link still resolves. Everywhere a route takes a workspace id it also takes that workspace's slug, including a slug the workspace retired within the last year. The UUID form keeps working for ever (ADR-033).

## Documents

| Method and path | Purpose | Response |
|---|---|---|
| `GET /documents/:id` | Metadata | `Document` (id, shortId, workspaceId, collectionId, parentId, slug, path, title, status, templateId?, templateVersion?, updatedAt, headRevision?) |
| `GET /documents/:id/content` | Published source | `{ revision, markdown, frontMatter }` or 404 before first publish |
| `GET /documents/:id/rendered?revision=` | Rendered body from the render cache (ADR-031) | `{ revision, html, outline: OutlineEntry[], slots: SlotKey[] }` |
| `GET /documents/:id/children?depth=&sort=&excerpts=&icons=` | What fills a `::children` slot for this reader (ADR-058): `depth` 1–6, `sort` `manual`, `title` or `updated`. Never lists a page the reader may not read; `private, no-cache` | `{ html, count }` |
| `GET /documents/:id/envelope` | The live envelope (ADR-031) | `{ permissions: { view, comment, edit, manage }, lock: { holderUserId, holderName, expiresAt } \| null, lastPublished: { revision, author, at } \| null, review: { dueAt, overdue } \| null, health: HealthSignal[] }` |
| `POST /documents/:id/publish` | Publish the current draft | body `{ base: revision \| null, changeNote? }` → `{ kind: 'published', revision }` or `409 { kind: 'merge-required', current, conflicts }`; `423 lock_lost`; `422 stale_base` |
| `GET /documents/:id/history?limit=&cursor=` | Revisions touching this document | `{ revisions: RevisionSummary[], nextCursor? }` |
| `GET /documents/:id/compare?from=&to=` | Two versions as one page, and what changed (ADR-015) | `{ html, summary, changes: Change[], sections: Section[], properties: PropertyChange[] }` |
| `GET /documents/:id/compare/source?from=&to=` | The two versions' Markdown, line by line | `{ lines: Line[], wordsAdded, wordsRemoved }` |
| `POST /documents/:id/draft/revert-preview` | Changes since a revision put back in the draft, not saved: for an editor to apply as its own edit | body `{ from?, draftVersion, changes: id[] }` → `{ draftVersion, ast }`; `409 stale_version`; `422 not_revertible` |
| `POST /documents/:id/draft/revert` | The same, saved, from outside the editor (the comparison page) | body as above → `{ draftVersion, previous }`; `409 stale_version`; `422 not_revertible`; `423 lock_lost` while another session edits |
| `POST /documents/:id/draft/revert/undo` | A revert undone with the `previous` it answered | body `{ draftVersion, ast }` → `{ draftVersion }`; `409`; `422 draft_unreadable`; `423 lock_lost` |
| `PATCH /documents/:id` | Rename a document, and move it | body `{ title?, slug?, path?, status?, collectionId?, parentId? }` → `Document`; `423 lock_lost`; `404`; `409 parent_outside_collection` / `parent_cycle` |
| `DELETE /documents/:id` | Delete a document, lifting its children to the root of their collection | `204` |
| `POST /documents/:id/restore` | New revision equal to an older one | body `{ revision, changeNote? }` → `{ kind: 'published', revision }` or `409 { kind: 'merge-required', current, conflicts }`; `423 lock_lost` |

`GET /documents/:id/rendered` sets an `ETag` of the render-cache key — the hash of everything the body was rendered from, plus the render version — and honours `If-None-Match` (ADR-031). The key, rather than the revision, because a rename in a document this body links to changes the body without changing its revision.

`slots` lists the live-block slots a body carries (ADR-032): today `children?depth=…&sort=…[&excerpts][&icons]`, one per distinct `::children` block. The reading view fills each from `GET /documents/:id/children`, whose `html` is the same template the public site fills its pages with, so the two draw a list identically.

### Comparing two versions

`from` is a revision, or absent to compare against an empty document (how a first revision reads). `to` is a revision, or `draft`: the document as its next publish would write it, which needs `edit`, as reading the draft does; a revision needs `view`. A revision that is not in this document's history is `404`, and so is `to=draft` on a document with no draft.

The comparison is the document's own, computed on the server by `@quill/markdown`'s differ (`packages/markdown/src/diff/`), and **says nothing about how revisions are stored**: no path, no hunk header, no `+++`/`---`, no revision hash in the body (`documents.integration.test.ts` holds this). Blocks are matched by content and position, so a paragraph moved elsewhere is `moved`, an edited one `changed`; inside a changed block the comparison goes as deep as the block's structure: words in a paragraph or heading, rows then cells in a table, items in a list, lines in a code block, blocks inside a quote, callout or details. Pictures (an image, a diagram, a leaf directive) are shown before and after.

- `html` is the newer document drawn by the reader's own renderer and sanitiser, with the older one's removals put back. Words are `<ins data-diff="added">` and `<del data-diff="removed">`, each opening with a visually hidden `<span data-diff-label>` ("Added: ", "Removed: "). A word replaced by one that shares its beginning or end has the characters that differ in `<span data-diff-char>`, empty on the side that has none there. A top-level block that changed carries `data-change` (`added`, `removed`, `changed`, `moved`); the first block of each change carries `data-change-id`; the halves of a before-and-after carry `data-side`. A changed code block is `div.code-block > pre[data-diff-code]`, a changed line an `ins`/`del` with `data-line`, its changed words `span[data-diff-word]`. A document's own strikethrough is a `del` without `data-diff`.
- `summary`: `{ sections, added, removed, changed, moved, wordsAdded, wordsRemoved }`, where `sections` counts sections with a change.
- `changes`: in reading order, `{ id, change, block, excerpt, wordsAdded, wordsRemoved, section?: { id, title }, html?, revertible?, author? }`. `html` is the change drawn on its own, only with `patches=true`. In a comparison with the draft, `revertible` says whether the change can be put back in the draft (a move cannot, nor a block the draft writes differently from what it would publish), and `author: { id, name?, at }` names who last saved it, from the record the draft keeps (`drafts.authorship`, stamped on every save and cleared when a publish moves the draft onto a new base); `name` is absent when the account is gone. `block` is `heading`, `paragraph`, `list`, `table`, `code`, `image`, `diagram`, `quote`, `callout`, `divider` or `block`.
- `sections`: the headings to depth 3, `{ id, depth, title, changes }`, whose ids resolve against `html`.
- `properties`: front-matter fields that changed, `{ name, before?, after? }`, never the document id.

`compare` sets an `ETag` of a digest of both sides' render inputs plus the render and comparison versions, and honours `If-None-Match`. `compare/source` answers `lines` of `{ change: 'equal' | 'added' | 'removed', before?, after?, segments: { change, text }[] }`, with line numbers from 1 on each side; within each stretch of change the removed lines come first and are paired in order with the added ones for their word-level segments.

Revisions are still named by the 40-character id every other route uses: the request carries them, and the response never echoes them.

### Publishing and restoring: the two failures that are not merges

Both writes are gated by the lock (ADR-021) and both derive the base from the draft, so both can answer with something other than a revision. Neither uses `409`, whose body on these routes is the merge payload the author needs and nothing else; both use the platform's error shape, `{ error: { code, message, details? } }`.

| Status | Code | Means | What the client does |
| --- | --- | --- | --- |
| `423` | `lock_lost` | Another session holds a live lock on this document: somebody took it over. `details.holder` is the lock row. | Stop autosave and enter recovery, exactly as for a draft write |
| `422` | `stale_base` | The `base` in the request is not the one the draft records. `details.base` is the draft's own base. | Re-read the draft and publish again |
| `422` | `draft_unreadable` | The draft was written by a newer release than this server | Report it; nothing the client can retry |

A document nobody is editing, and a document whose lock has lapsed, both publish freely: an author who closed the editor released their lock and has lost nothing. `base` is still required in the body — a document's first publish sends `null`, and every publish after it sends the `baseRevision` the draft carries.

`POST /workspaces/:id/documents` answers `422 path_unavailable` when every path a title could take is already held (fifty of them); the author renames the document. It answers `500 short_id_unavailable` when five short keys in a row were already taken, which names a generator that has stopped being random rather than anything the caller did (ADR-035).

**Renaming a document is a write to the document** (ADR-015). A document's title lives in its content — the front matter `title`, and the first heading when that is what names it (ADR-005) — and `Document.title` is an index of that, rebuildable from the content (ADR-034). So `PATCH /documents/:id` with a `title` rewrites the draft's front matter, and the heading when the heading is the title, alongside the row: it bumps the draft version, and the next publish carries the new name into the content store. It never publishes on the author's behalf, because a draft may hold work nobody has asked to publish. Being a write, it re-validates the lock and answers `423 lock_lost` while another session is editing the document, with `details.holder` — the same answer, and the same recovery, as a draft write.

`Document.shortId` is the document's permanent public handle, assigned at creation and never changed. `Document.slug` is the words for a URL, derived from the *current* title on every read and never stored as identity, so a renamed document hands out its new words immediately; the stored path segment — which `PATCH /documents/:id` may set and which carries a `-2` where two documents in a workspace share a title — is the last segment of `path`.

## Workspaces and navigation

| Method and path | Purpose | Response |
|---|---|---|
| `GET /workspaces` | Every workspace the caller may view, for the picker | `WorkspaceListItem[]` |
| `GET /workspaces/:idOrSlug` | One workspace, by id or by slug (ADR-035) | `Workspace` |
| `PATCH /workspaces/:idOrSlug` | Rename a workspace, and optionally move its slug | body `{ name, slug? }` → `Workspace`, or `409 workspace_slug_taken` |
| `GET /workspaces/:id/collections` | The workspace's collections, by name, for pickers | `Collection[]` |
| `POST /workspaces/:id/collections` | Create a collection; the slug is derived from the name | body `{ name }` → `Collection`, or `409 collection_slug_taken` |
| `PATCH /collections/:id` | Rename a collection; the slug does not move | body `{ name }` → `Collection` |
| `DELETE /collections/:id` | Delete an empty collection | `204`, or `409 collection_not_empty` with `details.documents` |
| `GET /workspaces/:id/tree` | Collections and documents as a tree for navigation | `{ collections: [{ id, name, slug, documents: TreeNode[] }] }` where `TreeNode = { id, shortId, title, slug, status, children: TreeNode[] }` |
| `POST /workspaces/:id/documents` | Create a document from blank or from a template | body `{ collectionId, parentId?, title, templateId?, answers? }` → `Document` plus an initial draft |

`GET /workspaces` decides visibility with the same resolver `GET /workspaces/:id` uses, so the picker can never offer a workspace a direct read would refuse: a workspace appears when the caller's identity resolves to at least `view` at the workspace or anywhere on the unit chain above it, and an instance administrator sees them all. The list is sorted by unit path and then by name, in code-point order, so it comes back the same way on every host. It needs a session but no other permission; a caller with no grants gets an empty array rather than a `403`.

Collections are a permission scope, not folders (ADR-012). Creating one needs `manage` on the workspace; renaming and deleting one need `manage` on that collection, which a grant at the workspace or a unit above it already confers. Listing needs only `view`.

Renaming a *workspace* leaves its slug alone unless the request names a new one. Moving a slug keeps the old one as a forwarding address for a year, so links written before the move still resolve (`workspace_slug_history`, ADR-035); a slug another workspace holds is refused with `409 workspace_slug_taken`.

A rename of a *collection* changes the name and nothing else: the slug is left exactly as it was, because documents are addressed by id and nothing points at a collection by its slug, so a rename can never break a link or a published path. A collection that still holds documents is not deleted — `collection_id` is nullable, and removing the row would take every document it held out of the permission tree — so the client moves or deletes them first and retries.

## Search (M3)

| Method and path | Purpose | Response |
|---|---|---|
| `GET /search?q=&workspace=&limit=&cursor=&facets=` | Find a document across every workspace the caller may read | `SearchResults` |
| `GET /search/suggestions?field=&prefix=&workspace=&limit=` | Complete the value of a filter (`by:`, `team:`, `tag:`, `collection:`, `in:`, `status:`) as it is typed | `SearchSuggestions` |

`q` is the query language `@quill/search` parses (ADR-010): bare words, `"quoted phrases"`, `-exclusions`, and the field filters `title:`, `tag:`, `owner:`, `status:`, `collection:` and `in:`, two about people: `by:` and `team:`, and `prop:key=value` over front matter. A filter value with spaces is quoted (`owner:"Ada Lovelace"`).

**People.** `by:` is whoever has published a revision of the document, as the revision recorded them (a name and an address; not necessarily an account — a Git-synced author is found too). `by:me` is the account the request is made as; a value with an `@` is an address, matched exactly; anything else is part of a name or an address, whatever its case, and `%` and `_` in it are ordinary characters. `team:` is a group by name with the groups nested inside it, or a unit by name or slug with all of its groups, and finds what any member has published; it is resolved when the search runs, so a person joining a team needs no reindex, and a name that matches nothing matches no document. Both can be left out with `-`. Neither widens what the caller may read: they narrow, inside the same permission filter as every other clause. Neither is answered on the public site (`/s/<site>/search` says so instead), because that would confirm to a stranger that an address wrote a published page.

**Tags are a hierarchy.** `/` separates a tag from its parent: `area/billing` is a child of `area`. `tag:area` finds a document tagged `area` or anything beneath it, `tag:area/billing` only that subtree. A tag is read lower case with space trimmed from it and from each segment and empty segments dropped (`Area / Billing`, `area//billing` and `/area/billing/` are `area/billing`); a value that is no tag (`/`) matches nothing. `tags` on a hit stay as written, folded.

**Properties.** `prop:key=value` asks about a front-matter key that is not a core field (`severity: high` in the front matter is `prop:severity=high`). The value is split at the first `=` (so it may contain one); key and value are trimmed and compared lower case; a value with spaces is quoted (`prop:"customer name=acme ltd"`). A filter with no `=`, an empty key or an empty value matches nothing, never everything, and so can be left out with `-` without effect. Only scalar values (strings, numbers, booleans) and lists of them are indexed, bounded to 30 keys a document, 20 values a key, 64 characters in a key and 200 in a value. Keys that are not core fields are searched only this way: they are never matched by a plain word, offered as suggestions or counted as facets. A document's properties appear after its next publish or `quill reindex`. Like `by:` and `team:`, `prop:` is not answered on the public site.

A colon the language does not reserve is read as part of a term, so a query is never refused for using one. It must be at least one character, and three things are refused with `422 invalid_query` and `details: { kind, position }`, so a search box can underline the character: a quote that never closes (`unterminated-quote`), a filter with no value (`empty-filter-value`), and a query that names nothing to look for — only exclusions — which would be an endpoint for enumerating everything the caller may read rather than a search (`nothing-to-search-for`).

**How the words are matched.** Every word has to appear. When that finds fewer than twenty documents — one screenful — the search runs again with the words matched as alternatives and answers with that instead, so a half-remembered phrase still finds its document rather than returning an almost-empty page. A quoted phrase is exact and never widened, and neither is the typo tolerance that otherwise brings in titles close to what was typed. Which of the two matchings a page came from travels in its cursor, because the two score the same document differently and a page-through must not change matching half way down.

`workspace` is the workspace the caller is *in*, by id or slug (ADR-035). It changes what is preferred, not what is visible: matches there come back in `current`, and every other workspace the caller may read is grouped under `elsewhere`, each group ordered by its own best match, groups ordered by theirs (quill-plan.md §15 — search is the one surface that crosses workspaces). Omitted, `current` is empty and every match is a grouped suggestion. A workspace the caller cannot read answers `404`, exactly as a direct read of it would.

`limit` is 1–50 and defaults to 20. `cursor` is the opaque `nextCursor` of a previous page and nothing else; one this server did not write answers `422 invalid_cursor`. Paging is keyset, and a cursor pins the instant the first page was ranked at, so the recency boost cannot shuffle later pages.

A `nextCursor` also appears when a page has exhausted the workspaces it searched but not the workspaces the caller can read: permissions are resolved for a bounded number of workspaces per request (five), the workspace named by `workspace` always among them, and the pages after carry the rest. Results are therefore ordered by relevance *within* the workspaces a page covered, and a later page may hold a group whose best match outscores one already shown. Nothing is hidden by this — only deferred.

`breadcrumb` names the workspace and the collection a hit sits in. That is deliberate: somebody allowed to see a document is allowed to see where it lives, and a result with no location is a title with nowhere to put it.

A search never returns a document the caller may not read: the permission filter is applied inside the engine's query (ADR-012), so a denied document is not merely absent from the results but is never scored, counted, or paged past. Searches are rate limited per session on their own budget (`SEARCH_RATE_LIMIT_MAX`, 60 a minute by default) and are deliberately not audited.

```ts
interface SearchResults {
  /** The query as it was asked, so a client can show what was actually searched. */
  query: string
  current: SearchHit[]
  elsewhere: { workspace: { id: string; slug: string; name: string }; hits: SearchHit[] }[]
  nextCursor?: string
  /** Only when `facets` was asked for. See Facets below. */
  facets?: { tag?: FacetValue[]; status?: FacetValue[]; collection?: FacetValue[] }
}

interface FacetValue {
  /** What goes after the filter key: `tag:<value>`, `status:<value>`, `collection:<value>`. */
  value: string
  /** What to show: the tag path, the status, the collection's name. */
  label: string
  /** Documents the query matched that carry it. At least 1. */
  count: number
}

interface SearchHit {
  documentId: string
  /** With `slug`, the whole readable address (ADR-035). */
  shortId: string
  slug: string
  title: string
  path: string
  workspaceId: string
  /** Workspace, then collection. */
  breadcrumb: string[]
  /** Plain text plus the matched spans as offsets into it — never HTML (ADR-010). */
  snippet: { text: string; ranges: { start: number; end: number }[] }
  score: number
  /** The document row's status: `draft`, `published` or `archived`. */
  status: string
  /** The document's last update, ISO 8601. */
  updatedAt: string
  /** The tags it was indexed with, lower case, in stored order; at most five. */
  tags: string[]
  /** Who has published it, most recent publisher first; at most three. Names only. */
  contributors: { name: string }[]
  /** How many distinct people have published it, so a row can say "Ada, Sam +2". */
  contributorCount: number
}
```

**What a row says about the document.** `status` and `updatedAt` come from the document row the response already loads; `tags` from the index row the hit was read from; `contributors` from one query for the whole page, never one per hit. A contributor is a *name*: never an address (a name that a tool recorded as an address is cut at the `@`, so the response carries no address at all). People are told apart by address behind the scenes, so `contributorCount` is the number of distinct people, not of revisions.

### Facets

`facets` is an optional comma-separated subset of `tag`, `status` and `collection` (for example `facets=tag,status`). Any other name, an empty value or a list that is not a list is `400` from schema validation. Absent, nothing is counted, `facets` is absent from the response, and the request costs what it always did. Asking for them on a later page is allowed; the counts do not change with the cursor.

Each requested facet is an array of at most eight `FacetValue`s ordered by `count`, largest first, then by `label` in code-point order (not locale order). A facet requested and empty (a stranger, or nothing matched) is an empty array.

- **Counts are over the whole set** the query matches and the caller may read, not over the page returned. A document the caller is denied is never counted: the permission filter is inside the same statement as the match (ADR-012), for every batch of workspaces, so a count is exactly what a person would find by paging to the end.
- **Counts reflect the query as asked, filters included.** They answer "what is in these results". A value the query already filters on is still returned (`tag:area/billing` still lists `area/billing`); a client hides it.
- **The strict match.** Counted are the documents every word of the query matches (and the same typo-tolerant titles an exact search includes), never the near misses the OR widening of a search with fewer than twenty results adds. So when a search widened, its facets describe the exact matches only.
- **Tags** are tag paths and include every ancestor: a document tagged `area/billing/invoices` counts under `area`, `area/billing` and `area/billing/invoices`, so `tag:<value>` returns exactly `count` results. **Statuses** are the status the index holds. **Collections** are named by the collection's name and counted together when two collections share one (as `collection:<name>` matches them together); a document in no collection is not counted.
- Only core facets exist: front-matter properties are not offered here.

Facets are answered by the same engine call for every client, and cost a statement per batch of workspaces when asked for; ADR-010's amendment of 2026-10-17 records the measured cost.

### Suggestions

`GET /search/suggestions` completes the value of a filter as somebody types it. It needs a session, shares the per-session rate-limit bucket of `GET /search` (a search box asks both as it is typed), and is not audited.

| Query | |
|---|---|
| `field` | Required. One of `by`, `team`, `tag`, `collection`, `in`, `status`. Anything else is `400`. |
| `prefix` | Optional, at most 100 characters, may be empty. Matched case-insensitively against the label: labels that start with it first, then labels that contain it, alphabetical within each. |
| `workspace` | Optional, id or slug, with the meaning it has for a search: the workspace the caller is in. It only changes which workspace is looked in first, never what may be offered. A workspace the caller cannot read answers `404`. |
| `limit` | Optional, 1-10, default 8. |

```ts
interface SearchSuggestions {
  field: string
  suggestions: { value: string; label: string }[]
}
```

`value` is what goes after `field:` (the client quotes it when it needs to); `label` is what the list shows. They are equal today for every field. Values are de-duplicated ignoring case.

**Privacy.** A suggestion is a search result with the document left off, so it obeys the rule a search does: it is drawn from what the caller may already read.

- `by` is the display name of people (accounts) who have published a revision of at least one document the caller may read. The permission filter is applied inside the index query, exactly as for a search, so a name that appears only on a document the caller is denied is not offered. Someone who published only through Git sync, with no account, is not suggested, and neither is a display name that is itself an address. Only names are returned, never addresses.
- `tag` is the distinct tags of documents the caller may read, by the same filter, and every node of the hierarchy: `area/billing` is offered as `area` and as `area/billing`.
- `team` is the name of a group or a unit, restricted to units that are the unit of a workspace the caller may read or are above one (ADR-012: units are private to one another), together with the groups of those units. Somebody who can read nothing is offered nothing, so a stranger cannot enumerate how the organisation is built.
- `collection` is the names of collections in the workspaces the caller may read (the answer `GET /workspaces/:id/collections` gives for each).
- `in` is the names of the workspaces the caller may read (the workspace picker's answer).
- `status` is the fixed set of document statuses, filtered by `prefix`; it names nothing of anybody's.

For `by` and `tag` the engine walks permissions a bounded number of workspaces at a time, as a search does, and stops as soon as the limit is filled. Values found in a later batch can therefore rank below ones already found; nothing is hidden by it.

## Attachments

| Method and path | Purpose | Response |
|---|---|---|
| `POST /documents/:id/attachments` | Upload a file (`multipart/form-data`, one field called `file`). Needs `edit` | `201 Attachment`; `413 payload_too_large`; `422 file_missing` / `file_empty` / `file_type_not_allowed` / `file_type_mismatch` / `file_malformed`; `429 rate_limited` |
| `GET /documents/:id/attachments` | What this document carries, oldest first. Needs `view` | `{ attachments: Attachment[] }` |
| `GET /attachments/:id` | The bytes. Needs `view` on the owning document | the file, with the headers below; `404` once it is deleted or if it never existed |
| `DELETE /attachments/:id` | Take it down. Needs `edit` | `204`; `409 attachment_in_use` with `details.documents` |

An attachment belongs to its document, so every decision about it is a decision about that document: `view` to read, `edit` to add or remove. A share link or the public principal will reach the read route through the same resolver when they arrive in M3 (ADR-012), with nothing in the route to change.

**What the server decides, and what it refuses.** The declared content type is a claim: the type is read from the file's own first bytes and a mismatch is refused (`file_type_mismatch`, with `declared` and `sniffed` in `details`). The allowlist is `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif` and `application/pdf`. **SVG is refused** — `file_type_not_allowed` with `details.sniffed` of `image/svg+xml` — because an SVG is a document that can carry script and fetch external references, which is the same reason the renderer's sanitiser will not accept one. The size cap (`ATTACHMENT_MAX_BYTES`, 25 MiB by default) is counted as the bytes arrive, so an oversized upload is refused rather than received; `details.maxBytes` carries the cap.

**What the server keeps.** An image is stored without what it carried besides its pixels (ADR-011, amendment of 2026-09-13): EXIF, XMP, IPTC, comments, text chunks and anything after the end of the picture are removed at the level of the file's container, with no decoder involved, and the colour profile, transparency, and animation are kept. `size` and `sha256` describe the file as stored, so they can differ from the file that was sent; a picture with nothing to remove is stored byte for byte. An image whose container cannot be read — cut short, framed wrongly — is refused with `file_malformed`, `details.contentType` naming the format and `details.reason` what stopped the reader. A PDF is stored exactly as sent. Because the hash is taken after the walk, the same photograph uploaded with and without its metadata is one object.

**What `GET /attachments/:id` answers with.** `Content-Type` is the *sniffed* type and never the uploader's claim. `Content-Disposition` is `inline` for an image and `attachment` for anything else, per RFC 6266: an ASCII fallback in `filename=` and the real name in `filename*=UTF-8''…`, so a name in any script survives the header. `X-Content-Type-Options: nosniff` stops a browser deciding for itself that a file the server called `image/png` is really HTML. `Content-Security-Policy: default-src 'none'; img-src 'self' data:; object-src 'none'; sandbox` is the second belt beside it. The `ETag` is the SHA-256, and `If-None-Match` answers `304`.

`Cache-Control` is `private, max-age=300, must-revalidate` rather than immutable. The bytes behind an id never change — but the *permission* to see them does, and a grant withdrawn this afternoon has to take effect this afternoon. The conditional request is answered **after** the authorizer runs, so a reader whose access has gone receives the refusal rather than a cheap `304` telling them their copy is still good.

The request itself is a plain `GET` with the session cookie and nothing else, which is all a browser sends for `<img src="/api/attachments/…">` on the app's own origin; the application's CSP stays `img-src 'self'`.

**What an upload is checked for.** The size is counted as the bytes arrive against `ATTACHMENT_MAX_BYTES`; the type is read from the first bytes and must be on the allowlist and must match what the request declared; JPEG and PNG metadata is stripped before the content hash is taken, so re-uploading the same photograph with and without its coordinates gives one object. Uploads are limited to `ATTACHMENT_RATE_LIMIT_MAX` per person per minute — flat, and spent only by an accepted upload.

**Where a document points at one.** `Attachment.url` is `/api/attachments/<id>` — relative, same-origin — and that is what the document's Markdown carries: `![Alt text](/api/attachments/<id>)`. The sanitiser admits that shape as an ordinary relative path. Export will rewrite it to a path inside the exported bundle (M4).

**Deleting.** The row is marked removed and the object is left where it is: the bytes are addressed by their hash and may be another attachment's, and the blob store is a system of record (ADR-034). A delete is refused with `409 attachment_in_use` while any published document still shows the attachment, which the link index answers — `/rendered` indexes the links of a document's published head — so the client takes the image out of the document, publishes, and deletes.

The question is asked only of the attachment's **own workspace**, and `details` carries `{ documents, hidden }`: the documents the caller may `view`, and a count of the ones they may not. A document somebody cannot open never blocks their delete by name.

**A draft's reference does not block a delete.** The link index holds the links of *published heads* only, so an attachment a writer has placed in a draft but not yet published can still be deleted — which is the right answer, because nobody is reading that draft but its author, and the alternative would make a picture undeleteable by having once been typed. The author's own draft then points at a file that is gone, which the editor shows as a broken image; publishing it is what would have made the reference real.

## Drafts and locks

Already implemented in M1 and unchanged: `GET /documents/:id/draft`, `PUT /documents/:id/draft` (`423 lock_lost`, `409 stale_version`, `401 session_expired`), and `/documents/:id/lock/{acquire,heartbeat,release,takeover}` per ADR-021.

## Shapes used by the web app

```ts
interface WorkspaceListItem {
  id: string
  unitId: string
  name: string
  slug: string
  createdAt: string
  /** The owning unit, plus that unit and every unit above it, root first. */
  unit: { id: string; name: string; path: string[] }
}
interface Collection { id: string; workspaceId: string; name: string; slug: string; createdAt: string }
interface TreeNode { id: string; shortId: string; title: string; slug: string; status: DocumentStatus; children: TreeNode[] }
interface OutlineEntry { id: string; depth: 1 | 2 | 3 | 4 | 5 | 6; text: string; children: OutlineEntry[] }
interface RevisionSummary { revision: string; author: { name: string; email: string }; timestamp: string; summary: string; changeNote?: string }
interface HealthSignal { kind: 'no-owner' | 'review-overdue' | 'required-section-empty' | 'broken-link'; detail?: string }
interface Attachment {
  id: string
  documentId: string
  /** Where the document's Markdown points at it: relative and same-origin. */
  url: string
  filename: string
  /** Sniffed from the bytes, never the uploader's claim. */
  contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif' | 'application/pdf'
  size: number
  sha256: string
  uploadedBy: string | null
  createdAt: string
}
```
