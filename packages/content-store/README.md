# `@quill/content-store`

The `ContentStore` port over a Git object model (ADR-014, ADR-015). Nothing above this package
knows about repositories, trees, refs, or commits; nothing below the six-method `ObjectStore` port
knows what a tree is. `GitContentStore` sits between them and speaks documents, revisions, and diffs.

**Two entry points.** `@quill/content-store` is the adapter, its backends, their options, and their
errors — that is everything an application is allowed to know. The Git vocabulary (objects, trees,
trailers, commit walks) lives behind `@quill/content-store/internal`, for maintenance code that reads
a repository *as* a repository: a revisions-index rebuild from commit trailers, an import, a
diagnostic. Importing it from the application, the server, or the web app breaks rule 9.

**Layout.** One bare repository per workspace, named by workspace id, under one root:
`<root>/<workspace-id>.git`. Loose objects under `objects/`, one branch (`refs/heads/main`), no
working directory, no index. Documents are Markdown files whose front-matter `id` is their identity,
so a move is a tree edit and history follows the id, not the path. `MemoryObjectStore` has the same
layout in a `Map` and is what the application layer's unit tests should use: about 0.1 ms per publish
against 7 ms on disk.

**Writes are atomic.** A loose object is deflated into a temporary file in `objects/`, flushed to the
disk, and renamed into place, so a process that dies mid-write leaves a stray temporary rather than a
truncated object under a name that promises the whole one — and the next write of that object
repairs it. Reads verify that what came back hashes to the object id that was asked for.

**Compare-and-swap.** Advancing a ref is the only concurrency primitive. On the filesystem backend it
is git's lockfile protocol — create `<ref>.lock` exclusively, re-read under the lock, write, append
the reflog, rename into place — so a shell in the repository stays safe. `EEXIST`, and on Windows
`EPERM` or `EBUSY` on a lock that is there, mean "contended, lose the race"; `EACCES` and `ENOSPC`
are reported as themselves. A lock file older than a minute is a **leak**, not contention: the
publish fails with `LeakedLockError` naming the file and its age, and never deletes it, because the
holder may be a slow `git` command rather than a dead process. Publishes for one workspace are
serialised in process ahead of the compare-and-swap, and a lost race is retried with jittered
backoff, because an immediate retry livelocks under eight concurrent publishers. A lost race leaves
an unreferenced commit; that is expected, and packing collects it.

**Stale publishes.** A publish carries the revision it was based on. A base that is not the head is
merged per document against the revision the two sides share; no base at all, or a base the store no
longer has, is treated as maximally stale and merged against the empty ancestor. A document the
other side moved is followed to its new path rather than duplicated, and a delete against another
author's edit — in either direction — comes back as `merge-required` for a person to settle.

**History is bounded twice.** `history` takes a `limit` on results and a `scanLimit` on commits
examined; `historySlice` returns the same revisions plus the cursor to resume from, because a limit
that bounds only the results does not bound the work.

**Packing is an operational requirement, not a nicety.** Publish p50 is flat in document count and
history depth, but p95 degrades roughly six-fold per 20,000 unpacked revisions, so monitoring alerts
on p95. This package never writes packfiles — it only reads them, deltas included, so a `git gc`-ed
repository stays readable, one positional read at a time rather than by loading the pack into memory.
Scheduled packing is the operations layer's job: run `git gc` inside `PackingHook.withRefLock`, which
serialises the pass against this process's publishes, checks the ref lock before it starts, drops the
cached packfiles afterwards, and reports `locked: false` when the ref moved underneath it. It cannot
*exclude* an outside `git gc` or another server's publish: a compare-and-swap is the only primitive
the port has, and a compare-and-swap cannot be held open.
