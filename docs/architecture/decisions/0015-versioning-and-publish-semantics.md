# ADR-015: Versioning and publish semantics

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 9 and 10; ADR-014, ADR-021; decisions D6, D12

## Context

Versioning must be free and invisible. Authors must never stage, commit, branch, or push, and must never be asked to think about versions unless they open the history.

## Decision

- **Publish is the only write** to the content store and the only way a revision is created. Autosave writes drafts, not revisions.
- Every publish is a revision attributed to the publishing user, with an optional change note. There is no way to publish without creating a revision.
- **History**, **compare**, and **restore** are the user-facing operations. Restore creates a new revision equal to an older one; history is never rewritten.
- Move, rename, and delete are revisions. Deleted documents are recoverable from history.
- Bulk operations (import, subtree move) produce one revision.
- Publish requires the revision hash the draft was based on, and that hash is the one **the draft itself records**, never one the caller supplies. A client sends the base it read as an assertion; a base that does not match the draft's is refused (`422 stale_base`) so the client re-reads, because merging against a base the author never edited from defeats the merge. A base that is behind the content store triggers a three-way merge of the Markdown; on conflict the user is shown a merge view. The same rule governs external edits arriving through Git sync.
- **Publish and restore are writes, and are gated by the lock like any other** (ADR-021): a publish is refused (`423 lock_lost`) when another session holds a live lock on the document, so the previous holder of a lock somebody took over cannot publish over the new holder's work. A document nobody is editing, or whose lock has lapsed, publishes freely — an author who closed the editor released their lock and has lost nothing.
- **Restore moves the draft onto the restored content**, and onto the revision the restore created. Leaving the draft holding what was undone would mean the author's next publish silently undid the restore. Replacing a draft's content bumps its version, so an editor that was open when the restore landed is told its next write is stale and re-reads (ADR-021).
- **Publish is a domain command** through which the later review workflow inserts an approval gate without changing storage.
- Document status is an extensible string union (`draft`, `published`, `archived` initially).

## Alternatives considered

- **A revision per autosave.** Rejected: meaningless history and repository bloat.
- **Branches per draft or per user.** Rejected: exposes Git concepts and complicates every read.
- **Last write wins on stale publish.** Rejected: silent data loss.

## Consequences

- The Postgres revisions index is the fast path for history; the content store is the source of truth and can rebuild it.
- A publish writes to the content store first and records the revision in Postgres second, so a failure in between leaves the two disagreeing: the bytes are in the store and nothing in the index, the document's head, or the outbox knows about them. Recording is therefore idempotent on `(document_id, revision)` — behind a unique index — so a retried publish adds no second history entry and no second event. Closing the window for good is the reconciliation pass that walks the store and rebuilds the index, `quill reindex` (ADR-034), which is why the index carries the revision it was derived from; the code carries a `TODO(M3)` where the window is.
- Formatting-only revisions are labelled in the diff view (ADR-002).
- **A rename edits the draft; the revision arrives with the next publish** (13 September 2026). "Move, rename, and delete are revisions" says where a rename ends up in history, not when it is written, and this ADR said nothing about the metadata edit itself. It says it now, because publishing re-derives a document's title from its content and was therefore writing the old name back over a rename that had only touched the Postgres row. A document's title lives in the document — the front matter `title`, and the first heading when that is what names it (ADR-005) — and `documents.title` is an index of it, rebuildable from the content like the rest of the metadata (ADR-034). So `PATCH /documents/:id` with a `title` rewrites the draft and the row together, in one transaction, and the publish that follows carries the new name into the content store as an ordinary revision. It does **not** publish on the author's behalf: a document's draft may hold work in progress that nobody has asked to publish, and a rename is not consent to publish it. A rename is a write like any other, so it bumps the draft version and is refused with `423 lock_lost` while another live session holds the document (ADR-021); a document with no readable draft has its row renamed alone, because an index this release cannot rebuild is not a reason to refuse the rename.
