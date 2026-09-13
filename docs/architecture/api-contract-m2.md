# M2 content API contract

The routes the reading view, the editor, and the publish flow use. The server implements these with TypeBox schemas so the OpenAPI description and the generated client match this document exactly; if the two disagree, the server's schema wins and this document is corrected.

All routes are under `/api`, require a session unless stated, and use the error shape `{ error: { code, message, details? } }`. Ids are UUIDs. Revisions are 40-character hex strings and are never called commits.

**Readable references (ADR-035).** Everywhere a route takes a document id it also takes that document's short key — ten Crockford base-32 characters, unique across the instance — with or without the title words in front of it: `/api/documents/<uuid>`, `/api/documents/k7m3q9v2xd`, and `/api/documents/authentication-architecture-k7m3q9v2xd` are the same request. The words are advisory and never consulted, so a stale title in a link still resolves. Everywhere a route takes a workspace id it also takes that workspace's slug, including a slug the workspace retired within the last year. The UUID form keeps working for ever (ADR-033).

## Documents

| Method and path | Purpose | Response |
|---|---|---|
| `GET /documents/:id` | Metadata | `Document` (id, shortId, workspaceId, collectionId, parentId, slug, path, title, status, templateId?, templateVersion?, updatedAt, headRevision?) |
| `GET /documents/:id/content` | Published source | `{ revision, markdown, frontMatter }` or 404 before first publish |
| `GET /documents/:id/rendered?revision=` | Rendered body from the render cache (ADR-031) | `{ revision, html, outline: OutlineEntry[], slots: SlotKey[] }` |
| `GET /documents/:id/envelope` | The live envelope (ADR-031) | `{ permissions: { view, comment, edit, manage }, lock: { holderUserId, holderName, expiresAt } \| null, lastPublished: { revision, author, at } \| null, review: { dueAt, overdue } \| null, health: HealthSignal[] }` |
| `POST /documents/:id/publish` | Publish the current draft | body `{ base: revision \| null, changeNote? }` → `{ kind: 'published', revision }` or `409 { kind: 'merge-required', current, conflicts }`; `423 lock_lost`; `422 stale_base` |
| `GET /documents/:id/history?limit=&cursor=` | Revisions touching this document | `{ revisions: RevisionSummary[], nextCursor? }` |
| `GET /documents/:id/diff?from=&to=` | Unified diff between two revisions | `{ from, to, unified, added, removed }` |
| `PATCH /documents/:id` | Rename a document, and move it | body `{ title?, slug?, path?, status?, collectionId?, parentId? }` → `Document`; `423 lock_lost`; `404`; `409 parent_outside_collection` / `parent_cycle` |
| `DELETE /documents/:id` | Delete a document, lifting its children to the root of their collection | `204` |
| `POST /documents/:id/restore` | New revision equal to an older one | body `{ revision, changeNote? }` → `{ kind: 'published', revision }` or `409 { kind: 'merge-required', current, conflicts }`; `423 lock_lost` |

`GET /documents/:id/rendered` sets an `ETag` of the render-cache key — the hash of everything the body was rendered from, plus the render version — and honours `If-None-Match` (ADR-031). The key, rather than the revision, because a rename in a document this body links to changes the body without changing its revision.

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
```
