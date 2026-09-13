# ADR-014: Content store and storage backends

**Status:** Accepted (confirmed with revisions by research R4, `docs/research/r04-content-store.md`)
**Date:** 2026-09-12
**Related:** quill-plan.md section 9; ADR-002, ADR-015, ADR-018, ADR-021, ADR-024; decisions D5, D6, D16

## Context

Documents must be storable on a filesystem, in a database or object storage for cloud deployments, and optionally synchronised with a Git repository, with backups and full version history, while users never see Git.

R4 implemented the publish path three ways and measured them. The decisive finding was not performance but pluggability: `nodegit` does not expose its object or ref database backends to JavaScript, so a Postgres or S3 backend is impossible without C++; `isomorphic-git` reaches other storage only through a POSIX filesystem shim and has no compare-and-swap on refs, so the safety-critical part would be hand-written anyway. Neither library provides the two backends this ADR requires.

## Decision

### Engine

- The content store is a **Git object model implemented in `packages/content-store`** (blob, tree, commit, tag encoding with SHA-1; loose objects; pack-index v2 and packfile reading including deltas) over an **`ObjectStore` port** of six methods: `read`, `write`, `has`, `readRef`, `casRef`, `writeBatch`. No third-party Git library is used for the store itself. The spike's implementation and its `git fsck --strict` and `git read-tree` / `git write-tree` round-trip tests are the starting point.
- It operates against a **bare repository**: no working directory, no index, no checkout, one branch.
- The application layer uses a `ContentStore` interface (`read`, `publish`, `history`, `diff`, `listTree`) whose vocabulary is documents, revisions, and diffs. Repositories, trees, refs, and commits never appear above it.
- Every repository the store writes must be readable by the real `git` CLI. `git fsck --strict` on a store-written repository is a CI check on every supported platform. If it ever disagrees with a tree the store wrote, stop and reconsider this ADR.

### Backends

| Backend | `ObjectStore` implementation | Use |
|---|---|---|
| Filesystem | Loose objects plus packfile reading; ref compare-and-swap via the standard lockfile protocol | Default self-host; simplest backup |
| Database or object storage | Objects keyed by hash in Postgres or S3-compatible storage; refs in a table with a conditional update on a version column | Cloud deployments without persistent volumes |
| Remote sync | Either of the above plus a background job (below) | Workspaces that opt into Git-managed documents |

Per publish the store performs 6 object reads, 7 object writes, 1 ref read, and 1 compare-and-swap, so the round-trip cost of the database backend is known in advance.

### Publish

Publish writes a blob, a tree, and a commit, and advances the ref with compare-and-swap. Commit messages carry `Quill-Document-Id` and `Quill-Change-Note` trailers so the Postgres revisions index can be rebuilt from the repository. Author is the user; committer is Quill.

Concurrency rules:

- Compare-and-swap is the lockfile protocol on the filesystem backend and a conditional update on the database backend.
- Publishes within one workspace are serialised in-process ahead of the CAS.
- A lost CAS is retried with **jittered backoff**. Immediate retry livelocks under eight concurrent publishers.
- A lost CAS leaves an unreferenced commit. That is expected and is collected by packing.

Encoding rules:

- Change-note trailers are **single-line**: newlines are folded to spaces on write. A folded continuation line makes naive trailer parsers drop the entire trailer block, including the document ID, which would break index rebuild.
- Paths are UTF-8, normalised to NFC at the application boundary.

### Staleness, conflict, and what a merge may decide

A stale-base publish is merged per document (below). Three cases are settled here because the merge cannot settle them on its own:

- **No base, or a base the store no longer has, against a workspace that does have revisions** is treated as *maximally stale*: the merge runs against the **empty** common ancestor, so every document already published comes back as a conflict unless our content matches it exactly. Rejecting the publish outright was the alternative; merging against the empty ancestor was chosen because it needs no new result kind and cannot silently overwrite. Skipping the merge — which is what "no base means no ancestor to merge against" would imply — is not an option: it is last-write-wins under another name, and ADR-015 rejected that.
- **A delete on one side and an edit on the other** — in either direction — is a **conflict**, not a silent resolution. A delete that discards another author's edit, and an edit that revives a document another author deleted, are both decisions only a person can make, so the publish comes back as `merge-required` with the surviving text on the other side.
- **A document another publish moved** is merged into the path it now has. A change names a path, but a document *is* its id (ADR-015), so a publish whose base predates a move retargets itself onto the current path rather than writing a second copy under the old one.

### Revisions index is a requirement

History from the repository alone is O(total commits): 27.6 s for one document's history at 20,000 commits, and the real `git log -- path` takes 9.8 s on the same corpus. The Postgres revisions index is therefore on the critical path for history and compare, not a cache. `ContentStore.history()` takes a mandatory scan limit. Index rebuild from trailers runs at about 3,100 commits per second and is the recovery procedure.

### Packing is an operational requirement

Publish latency is flat in document count and in history depth (about 10.5 to 11 ms p50 on this machine at 31 commits and at 20,000, of which 99 percent is file I/O), but the **p95 degrades roughly six-fold per 20,000 unpacked revisions** while the median barely moves. Packing restores it. Scheduled packing of the filesystem backend is a first-class operational requirement recorded in ADR-018 and ADR-024, the maintenance job takes the same ref lock the store uses, and the store keeps reading correctly while packing runs. Monitoring alerts on publish p95, not p50.

### Remote sync strategy

Remote sync ships in the first release, and it needs packfile writing and the Git wire protocol, which the store deliberately does not implement. Sync therefore works on a **materialised standard repository**:

- On the filesystem backend the bare repository already is one. The sync job pushes and pulls it with `isomorphic-git` (pure JavaScript, no binary required), with the `git` CLI as the operator's tool.
- On the database backend the sync job materialises the objects reachable from the ref since the last sync into a temporary bare repository, pushes with `isomorphic-git`, and on pull imports fetched objects (loose or packed; the packfile reader handles both) into the object store.

The store's own packfile writer is deferred until a measured need, and the wire protocol is never implemented in Quill code.

### Drafts and attachments

Drafts are not in the content store (ADR-021). At 5 to 7 new objects and about 10 ms per publish, a revision per autosave would be ruinous in latency and object count. Attachments are in a blob store referenced by hash; images under a size threshold may also be written beside the document so exports are self-contained.

### Three-way merge

Stale-base publishes and external edits are merged with `node-diff3`. Its output is byte-identical to `git merge-file`, including conflict markers, at 0.011 ms against 39.6 ms for the shell-out.

### On-disk layout

Human-readable: one directory per workspace, `index.md` for documents with children, `.quill/workspace.yaml` for settings. A clone produces exactly the tree in the plan's section 9.5 and `git log` and `git show` read it.

## Alternatives considered

- **`nodegit` (libgit2 binding).** Builds and loads on Node 24 and is the only option with a real ref compare-and-swap, but its object and ref database backends are not exposed to JavaScript, so the object-storage backend cannot be built. It is also 3.5 times slower, 115 MB, and pnpm refuses to install it because of a git-URL sub-dependency.
- **`isomorphic-git`.** All bare-repository primitives present and repositories pass `git fsck`, but no ref compare-and-swap (`writeRef` is an unconditional overwrite), pluggability is a filesystem shim rather than an object store, and it is 20 to 45 percent slower. It remains the right tool for the wire protocol on a materialised repository, which is how sync uses it. If it gains a genuine object-store interface with CAS refs, revisit this ADR.
- **Content and revisions in Postgres with Git as a two-way sync adapter.** Rejected: two revision models, and two-way sync with an external repository is where rewrites hide.
- **Requiring a Git repository for every deployment.** Rejected: cloud deployments without volumes need the object-storage backend.
- **A working-directory model driven by the git CLI.** Rejected: slow, racy, and impossible against object storage.

## Consequences

- Quill owns about 700 lines of Git object encoding with `git fsck --strict` as the arbiter of correctness.
- The in-memory `ObjectStore` makes the whole content store unit-testable with no I/O at about 0.1 ms per publish.
- No native addon, no `node-gyp`, no rebuild on Node majors.
- Rename detection by similarity is not available; history follows the document ID (ADR-015), which is the better answer, but imported repositories without IDs do not get Git's heuristic.
- Two Windows hazards are handled in the filesystem backend: `rename()` returning EPERM over an open destination, and lockfile `O_EXCL` returning EPERM on a pending delete. The second is treated as contention only while the lock file is actually there; EACCES and ENOSPC are reported as themselves, because a retry loop over an error that never clears is worse than the error.
- **A leaked `<ref>.lock` is a distinct failure, and is never removed automatically.** A lock older than a threshold (a minute by default, measured against the injected clock) fails the publish with an error naming the file and its age, instead of being counted as one more lost compare-and-swap race. The two need opposite answers: a lost race is retried, a leaked lock never clears. It is reported rather than deleted because the holder may be a slow `git` command in an operator's shell, and guessing wrong puts two writers on one ref; recovery is an operator removing the file the error names.
- **History takes a scan budget as well as a limit.** A limit bounds the results, not the work, and one old revision in a deep history costs a full walk. `history` therefore stops after a bounded number of commits and reports how far it got, so a caller can resume; the port still returns only the revisions, because the Postgres revisions index is the fast path and this is the rebuild path behind it.
- **Commit identities are sanitised the way git sanitises them.** A display name is user input, and `<`, `>`, and newlines are the commit-header syntax itself, so they are stripped before an identity is written: otherwise a name could add a `parent` line, breaking `git fsck` and clone, or forge the trailer block the revisions index is rebuilt from.
- **Loose objects are written through a temporary file and renamed into place**, and a read verifies that what came back hashes to the name it was asked for. A crash mid-write used to leave a truncated object under a name that promised the whole one, which a later content-addressed "it already exists" would never repair.
- **The packing hook detects interference; it cannot exclude it.** `withRefLock` serialises passes against this process's publishes, takes the ref lock once before starting, and reports whether the ref moved while the work ran — but the object-store port's only concurrency primitive is a compare-and-swap, and a compare-and-swap cannot be held open. An external `git gc` is therefore not excluded by it, and the earlier claim that it was has been removed.
- **The package has two entry points.** The public one is the adapter, its backends, their options, and their errors; the Git vocabulary — objects, trees, trailers, commit walks — is behind `@quill/content-store/internal`, so rule 9 of `AGENTS.md` is enforced by the module boundary and not only by review.
- ADR-015 is confirmed without change: publish as the only write, stale-base three-way merge, restore as a new revision, and one-commit bulk operations were all implemented and measured.
