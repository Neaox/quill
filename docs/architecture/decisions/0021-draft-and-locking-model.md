# ADR-021: Draft and locking model

**Status:** Accepted (confirmed by research R5, `docs/research/r05-draft-locking.md`)
**Date:** 2026-09-12
**Related:** quill-plan.md section 10; ADR-014, ADR-015; decision D7

## Context

Simultaneous editing is not a first-release requirement, but two people opening the same document must never lose work, and a browser crash must never leave a document locked. Real-time co-editing arrives later and must not require a storage rewrite.

## Decision

- **Drafts** are Postgres rows holding the AST as JSON, a monotonically increasing draft version, and the published revision hash the draft is based on. Autosave writes drafts.
- **One lock per document**, held by a user session. Acquire is a single `INSERT ... ON CONFLICT DO UPDATE WHERE expires_at < now()` so there is exactly one holder and no race.
- **Heartbeat** every 15 seconds; **expiry** after 60 seconds without one. Expiry is evaluated on acquire and on every heartbeat; nothing sweeps. A heartbeat whose session still matches the row but whose expiry has passed **fails**, even if nobody else has acquired the document yet. The expiry comparison is a strict less-than, so an exact-millisecond tie is not expired.
- **Release** on close, on navigation via `sendBeacon`, and on expiry. Release is idempotent and always succeeds, because a beacon cannot read a response.
- **Takeover**: editors may take an expired lock (by acquiring again); workspace admins may take an active one. The previous holder's next write is rejected and its client keeps the changes locally with a recovery path.
- **Optimistic draft versions**: every write carries the version it read; stale writes are rejected, which makes two tabs of the same user safe. A write must **also re-validate that the caller holds a non-expired lock**, inside the same transaction. Version continuity alone does not detect a takeover, because the new holder's writes keep incrementing the same counter.
- **Clock injection**: lock and draft modules take the current time as an argument rather than calling `now()` in SQL, so tests use a fake clock deterministically.

### API contract

Status codes are distinct so the client branches on them without parsing the body; the body carries detail for the UI.

| Endpoint | Success | Failure |
| --- | --- | --- |
| `POST /documents/:id/lock/acquire` | `200 { lock }` | `409 { reason: "held", holder }` |
| `POST /documents/:id/lock/heartbeat` | `200 { expiresAt }` | `410 { reason: "expired" }` own lock lapsed; `409 { reason: "taken_over", holder }`; `404 { reason: "released" }` |
| `DELETE /documents/:id/lock` | `204`, unconditionally | none |
| `POST /documents/:id/lock/takeover` | `200 { lock }` | `403` if not an admin |
| `PUT /documents/:id/draft` | `200 { draftVersion, updatedAt }` | `423 { reason: "lock_lost", holder }`; `409 { reason: "stale_version", currentVersion }`; `401 { reason: "session_expired" }` |

`423 Locked` means "you do not hold a valid lock: stop autosave and enter recovery". `409 Conflict` on a draft write means "you hold the lock but your version is behind: re-read and retry". The client never resumes autosave after a reconnect without first re-validating through a heartbeat.
- **Local recovery**: the client holds unsent changes in IndexedDB until acknowledged and resends on reconnection.
- **Presence**: readers see who is editing, by polling first and server-sent events later.
- Real-time co-editing later replaces the lock with a Yjs document on the same draft row; publish semantics (ADR-015) do not change.

## Alternatives considered

- **Yjs from the start.** Rejected: more moving parts before the editor converter is proven; locking is simpler and safer for release 1.
- **Lock-free last-write-wins.** Rejected: silent data loss.
- **Server-side sweeper for expired locks.** Rejected: an extra process for something the acquire query handles.

## Consequences

- The locking module is tested with a fake clock, two simulated clients, network partition, and takeover scenarios, at full coverage. The R5 spike suite (1,000 contended acquires with exactly one winner each time, expiry, heartbeat, takeover, two-tab, release, and partition cases) is the reference for those tests.
- R5 measured, on local Postgres with 100 concurrent editors: acquire about 17 ms p50 and 20 ms p95, heartbeat about 12 ms p50 and 14 ms p95, lock-checked draft write about 47 ms p50 and 50 ms p95. The 15 s / 60 s parameters stand; the ratio tolerates two to three dropped heartbeats.
- Every write re-validates the lock, not only autosave: a publish and a restore are refused with `423 lock_lost` when another session holds a live lock, checked once before the content store is written to and again inside the transaction that records the revision. Release stays unconditional and always succeeds — there is no "not the holder" answer, because a beacon could not read one.
- The remaining risk is client-side: a client must treat a failed heartbeat as loss of confidence immediately, escalate the UI after one and two missed heartbeats, and never assume it still holds the lock because requests started succeeding again.

## Amendment (2026-10-11): offline without noticing, and merging drafts

People go offline without realising: a train, a captive portal, a sleeping laptop, a flaky VPN. The editor must keep working through it, say honestly what is happening, and never make the author choose between their work and someone else's when the two can be combined. The writing surface is also held to "as performant and responsive as possible": nothing on the network path may ever delay a keystroke.

### Working through a disconnection

- **Typing never waits on the network.** Edits apply locally at once. Autosave, heartbeats and saves run in the background; the reliability work of 11 October made them retry with capped backoff, resume on `online` and `visibilitychange`, and never drop an edit.
- **Disconnection is detected, not assumed.**
  - Heartbeat and save failures are the signal; `navigator.onLine` alone is not trusted, because captive portals and broken VPNs report "online".
  - The status reads "Offline: your changes are kept on this device". The words are always present; colour is never the only signal.
  - After about 60 seconds it also says plainly that someone else may be able to edit, because the lock expires then.
- **The base is kept.** The local recovery store keeps the draft **as it was when this editor last agreed with the server**: the tree acknowledged by the last successful save, or the one loaded at open. It is kept alongside the unsent changes, so a three-way merge always has its common ancestor. Each acknowledged save replaces the base; nothing grows without bound.

### Reconnecting: three-way merge of drafts

On reconnecting, the client re-validates through a heartbeat as before. It then has three trees: the **base** (the last version both sides agreed on), **mine** (local, unsent) and **theirs** (the server's current draft).

- **Nobody else wrote** (theirs equals the base): save mine, as today.
- **Someone else wrote and the lock is free, or ours again:** re-acquire the lock and **merge**:
  - **Block level first.** Top-level blocks are matched between base, mine and theirs by content hash and position (a longest-common-subsequence over block identities), so a paragraph moved or inserted on one side is recognised as such.
  - **Then within blocks that both sides changed:**
    - text is merged by words (diff3);
    - list items by item;
    - table rows by row, then cells;
    - code blocks by line;
    - directives and front-matter fields by attribute.
  - **Non-overlapping changes combine automatically.** The merged draft is saved with the server's version as its expected version, and a quiet toast says what happened: "Merged your offline changes with Sam's".
  - **Overlapping changes become conflicts.** Each is resolved in place, block by block, side by side: "Keep mine", "Keep theirs", "Keep both" (mine below theirs) or "Edit". Until every conflict is resolved, the merge stays a local draft, saved to the recovery store and never lost. Only the resolved result is saved to the server.
  - **The other editor is told** when their draft has been merged into, through the presence channel or on their next load: "Alex merged offline changes into this draft".
- **Someone else holds the lock now:** our changes stay safe on this device, with "Sam is editing now. Your offline changes are kept and will be merged when Sam finishes." When the lock frees, the merge above runs. Workspace admins keep their takeover right, and a takeover runs the same merge.
- **"Keep mine" stays available** but is no longer the main path. It is an explicit overwrite, behind a confirmation that names what will be lost.

### Correctness and speed

- **One merge engine.** The merge is a pure function over mdast in `packages/markdown`, so it can be tested exhaustively.
  - **Properties:** merging with an unchanged side is the identity; merges are symmetric up to the order of "keep both"; round trips are byte-stable for untouched blocks; conflict detection never loses a change.
  - **Fixtures:** taken from the corpus.
- **Reuse.** The publish path's three-way merge of Markdown (plan section 9) uses the same engine, so drafts and publishing cannot disagree about what a conflict is.
- **Speed.**
  - Merging a 4,000-line document stays within the editor's budgets (quill-plan.md section 31). Large documents merge in a worker.
  - The conflict view renders only the blocks in conflict, plus context, never the whole document twice.
- **Tests:** a fake clock, two simulated clients and network partitions, as this ADR already requires. They cover a disconnection the client doesn't notice, the lock expiring and being taken while offline, both sides editing different blocks, both editing the same block, and a reconnect while the other person still holds the lock.

### The goal: co-editing

Real-time co-editing with Yjs, as the original decision anticipated, remains the goal. It merges concurrent and offline edits automatically, character by character, and the lock becomes presence. When it lands, it replaces this merge for drafts. The block-level three-way merge then remains for publishing and Git sync, where there is no shared CRDT history.
