# R4 — Content store: Git engine, backends, layout, performance

**Question.** Which Git engine implements the ADR-014 content store against a bare repository with no working directory — `isomorphic-git`, a libgit2 binding such as `nodegit`, or a small object model written on `node:zlib` and `node:crypto`? The answer must also settle whether ADR-014's Postgres/S3 object backend is reachable at all, and whether publish and history are fast enough.

**Time box.** Part of the four-week R1–R9 window; R4 is on the critical path with R3 and R5. This spike ran to completion inside its box. If it had expired without an answer, the fallback was `isomorphic-git` on the filesystem backend only, with ADR-014's object-storage backend deferred to a later ADR — which is the outcome the spike existed to avoid, since that backend is where the rewrite risk lives.

## What was examined

| Thing | Version | Notes |
| ----- | ------- | ----- |
| [`isomorphic-git`](https://isomorphic-git.org) | 1.42.0 | Pure JS. 55 packages and 8.4 MB installed on its own. `engines: node >= 14.17`. |
| [`nodegit`](https://www.nodegit.org) | 0.28.0-alpha.38 | libgit2 binding. `engines: node >= 20`. 151 packages, 115 MB installed. |
| Hand-written object model | this spike | 332 lines of object model (`src/git-core.ts`), 371 lines of filesystem backend including a packfile reader (`src/fs-store.ts`). Zero dependencies. |
| [`node-diff3`](https://github.com/bhousel/node-diff3) | 3.2.1 | Three-way merge. Zero dependencies. |
| [`diff3`](https://github.com/axosoft/diff3) | 0.0.4 | Three-way merge, by nodegit's maintainers. Unmaintained (still 0.0.x). |
| `git` CLI | 2.54.0.windows.1 | Used as the oracle for correctness, and as a performance baseline. |

Spike: [`spikes/r4-content-store/`](../../spikes/r4-content-store/). All numbers below are reproduced by `node bench.ts --docs 1000,10000 --commits 20000`, `node bench.ts --engine iso --docs 1000 --commits 400`, `node scale-check.ts`, `node profile.ts`, `node merge-demo.ts`, `node test.ts`, `node test-edge.ts` and `node probe-nodegit/probe.ts`. Raw logs are in the spike (`bench-own.log`, `bench-iso.log`, `scale-fs.log`, `results-own.json`).

**Measurement machine.** AMD Ryzen 9 5900X (24 threads), 64 GB RAM, Windows 11 Pro 26200, NTFS on NVMe, Microsoft Defender real-time protection **on**, Node v24.21.0. Windows is the slow case for this workload: a publish touches 13 small files, and Defender rescans each file the first time it is opened after a write. A Linux server will be materially faster; nothing here depends on that being true.

## Findings

### F1 — All three can write blobs, trees and commits without a working tree or index

This was the cheapest thing to disprove and none of them fail it.

- Hand-written: by construction. `setPath` walks the previous tree, replaces one entry, and rewrites the O(depth) trees above it.
- `isomorphic-git`: `writeBlob`, `readTree`, `writeTree`, `writeCommit`, `readCommit`, `resolveRef`, `writeRef`, `readBlob`, `log` all take a `gitdir` and never touch a working tree or an index.
- `nodegit`: `Repository.init(path, 1)` gives a bare repo; `Treebuilder` builds trees with no index; `createCommit` writes the commit and moves the ref.

### F2 — Only `nodegit` ships a ref compare-and-swap, and it cannot be used

ADR-014 requires compare-and-swap on the ref.

- `nodegit` exposes `Reference.createMatching`, which is libgit2's `git_reference_create_matching`. It is a real CAS: the probe confirms a stale expected value is rejected.
- `isomorphic-git` has **no** CAS. `writeRef` is an unconditional overwrite; two concurrent publishes silently lose one. The lockfile protocol has to be written by hand regardless, which is what the spike's `isogit-store.ts` does — it borrows the hand-written backend's `casRef`.
- The hand-written backend implements git's own protocol: create `<ref>.lock` with `O_EXCL`, re-read the ref under the lock, compare, rename into place, append a reflog entry. The git CLI uses the same lock, so a `git gc` or `git push` running beside the server cannot interleave badly.

### F3 — `nodegit` cannot implement the Postgres/S3 backend at all. This is decisive.

libgit2 has pluggable backends (`git_odb_backend`, `git_refdb_backend`). `nodegit` does not expose them:

```
present  Odb.open           present  Odb.addDiskAlternate      present  Treebuilder
present  Reference.create   present  Reference.createMatching  present  Repository.createCommit
MISSING  OdbBackend         MISSING  RefdbBackend              MISSING  Merge.file
```

`Odb.addDiskAlternate` only adds another *directory*. Storing objects in Postgres or S3 through `nodegit` means writing a C++ addon, which is not a dependency choice, it is a second product.

`isomorphic-git` is pluggable, but the plug is the wrong shape: you inject an object that impersonates a POSIX filesystem (`readFile`, `writeFile`, `readdir`, `stat`, `lstat`, `unlink`, `mkdir`, `rmdir`, `symlink`, `readlink`). A Postgres-backed store then has to emulate directory listings and `stat` results for a path namespace it does not have, and `isomorphic-git` still decides on its own when to write loose objects, when to consult packs, and how to lock. It works; it is a leaky port.

The hand-written model has a six-method port, which is the whole surface a backend implements:

```ts
interface ObjectStore {
  read(oid): Promise<{ type, body } | null>
  write(oid, type, body): Promise<void>
  has(oid): Promise<boolean>
  readRef(name): Promise<string | null>
  casRef(name, expected, next): Promise<boolean>
  writeBatch?(objects): Promise<void>
}
```

The spike implements it three times — filesystem, in-memory key/value, and a caching decorator — and the `ContentStore` above it does not change.

### F4 — Installability

| Engine | Install | Result |
| ------ | ------- | ------ |
| `isomorphic-git` | `pnpm install --ignore-workspace` | 0.8 s, **55 packages**, 8.4 MB (2.5 s / 57 packages together with the two diff libraries) |
| `node-diff3` | same | included above, zero deps |
| `nodegit` | `pnpm install` | **fails**: `ERR_PNPM_EXOTIC_SUBDEP — "nan" (resolved via git-repository) is not allowed in subdependencies` |
| `nodegit` | `npm install` | 48 s, 151 packages, 115 MB; npm 11 blocks its install scripts, so `npm rebuild nodegit --foreground-scripts` is also required |
| hand-written | none | zero dependencies |

`nodegit` did load on Node 24.21.0 (win32 x64) from a prebuilt node-pre-gyp binary — the "does it even build on Node 24" question is a *yes* — but a dependency our package manager refuses outright, in a monorepo whose gate is `pnpm check`, is not viable.

### F5 — Publish latency is flat in documents and in history, and degrades with the loose-object count

Publish writes one blob, rewrites the O(depth) trees above it, writes one commit, and CASes the ref. Nothing in that walks the repository or the history. n = 300 per row, `node bench.ts --docs 1000,10000 --commits 20000`.

| Engine | Repository | p50 | p95 | p99 | max |
| ------ | ---------- | --- | --- | --- | --- |
| hand-written | 1,000 docs, 31 commits | **10.65 ms** | 13.02 ms | 14.42 ms | 19.6 ms |
| hand-written | 1,000 docs, 20,000 commits | **10.45 ms** | 12.45 ms | 14.56 ms | 104 ms |
| hand-written | 10,000 docs, 31 commits | **10.96 ms** | 14.58 ms | 17.56 ms | 20.3 ms |
| hand-written | 10,000 docs, 20,000 commits † | 71.17 ms | 156.68 ms | 204.21 ms | 404 ms |
| hand-written | 10,000 docs, 20,000 commits, clean process ‡ | **16.82 ms** | 89.41 ms | — | — |
| hand-written | 10,000 docs, 20,000 commits, **after `git gc`** | **12.05 ms** | — | — | — |
| in-memory store | 10,000 docs, at every 2,000 commits up to 20,000 | **0.10–0.11 ms** | 0.13–0.17 ms | — | — |
| `isomorphic-git` | 1,000 docs, 31 commits | 15.50 ms | 18.38 ms | 19.75 ms | 20.6 ms |
| `isomorphic-git` | 1,000 docs, 400 commits | 12.53 ms | 15.75 ms | 17.36 ms | 18.5 ms |
| `nodegit` | 1,000 docs, 200 commits | **38.77 ms** | 43.53 ms | 49.68 ms | — |

Head to head on the same 1,000-document corpus: hand-written **10.65 ms**, `isomorphic-git` **12.5–15.5 ms** (20–45 % slower), `nodegit` **38.8 ms** (3.5×). Single-document `read` follows the same ordering: 1.56 ms, 2.78 ms, —. `isomorphic-git`'s own repositories also pass `git fsck --strict` and survive `git gc`, so this is a speed difference, not a correctness one.

† Measured by `bench.ts`, which runs both repository sizes in one process on one volume, so the 1,000-document repository's 143,393 loose files were still on disk beside it. ‡ The same workload re-measured by `scale-check.ts` in a fresh process on a fresh temp root. The gap between the two is itself the finding: loose-object trees on the *same volume* interfere with each other.

Four statements, each separately measured:

1. **History depth costs nothing.** The 1,000-document repository held 10.95–11.04 ms per commit while growing from 331 to 20,000 commits (216.2 s total); its p50 at 20,000 commits (10.45 ms) is indistinguishable from its p50 at 31 (10.65 ms).
2. **Document count costs nothing.** 10,000 documents publish in 10.96 ms at 31 commits, the same as 1,000, because publish touches O(path depth) trees, not O(documents).
3. **The engine costs nothing and never degrades.** Against the in-memory store, the identical 10,000-document / 20,000-commit workload is flat at **0.10–0.11 ms p50 from commit 1 to commit 20,000** (`node scale-check.ts --store memory`).
4. **The loose-object file count does cost, and it hits the tail first.** The same workload on disk, in a clean process (`node scale-check.ts --store fs`), sampled per 2,000 commits:

| Commits so far | p50 | p95 |
| -------------- | --- | --- |
| 2,000 | 11.96 ms | 14.91 ms |
| 8,000 | 11.68 ms | 14.58 ms |
| 14,000 | 11.67 ms | 14.94 ms |
| 16,000 | 12.07 ms | **28.21 ms** |
| 18,000 | 14.56 ms | **58.11 ms** |
| 20,000 | **16.82 ms** | **89.41 ms** |

The median drifts 1.4× over 20,000 publishes; the 95th percentile degrades **6×**, and it starts somewhere past 100,000 loose objects. In `bench.ts`, where a second large loose-object tree shared the volume, the median went to 71 ms and `read(path, HEAD)` went from 1.56 ms to 12.94 ms for the same seven file reads. `git gc` restores it: 12.05 ms.

This is an NTFS-and-Defender effect on a directory tree of ~150,000 small files, not a property of Git or of the engine — but it is the most important operational finding in the spike. **A filesystem-backed content store must have `git gc` scheduled.** Without it, publish p95 degrades by roughly 6× per 20,000 revisions, and the degradation is invisible in median-only monitoring.

### F6 — Almost all of that 10 ms is Windows file I/O, not the object model

`node profile.ts`, 300 publishes against a 1,000-document repository:

| Configuration | ms / publish | Breakdown |
| ------------- | ------------ | --------- |
| Loose objects on disk | **11.26** | tree read+write 4.87 (43 %), ref read 2.32 (21 %), CAS 1.85 (16 %), commit read 0.88, blob write 0.68, commit write 0.64 |
| Loose objects + tree/commit read cache | **8.89** | tree read+write 3.39, ref read 2.28, CAS 1.84 |
| In-memory objects (engine only) | **0.11** | tree read+write 0.08 |

SHA-1, zlib, tree and commit encoding cost **0.11 ms**. The remaining 11.15 ms is thirteen small NTFS file operations. That matters for two reasons: the choice of engine is nearly irrelevant to publish latency on a filesystem backend, and a Postgres or S3 backend will be dominated by its own round trips, not by the engine.

Round trips a key/value backend must serve, counted against the in-memory store:

> **6 object reads, 7 object writes, 1 ref read, 1 CAS per publish**, at a path depth of 5.

### F7 — History from the repository alone is unusable, and this is not our fault

Asking for the last 20 revisions of one document, over 20,000 commits:

| Method | 1,000 docs p50 | 1,000 docs p95 | 10,000 docs p50 | 10,000 docs p95 |
| ------ | -------------- | -------------- | --------------- | --------------- |
| `history(path)`, commit walk + tree resolve | **27.6 s** | 31.7 s | **33.1 s** | 39.8 s |
| `history(path)` with an in-process tree/commit cache | 2.2 s | 15.8 s | 2.2 s | 18.7 s |
| `historyByDocumentId`, commit trailers only, no tree reads | 4.9 s | 4.9 s | 5.4 s | 5.8 s |
| `historyByDocumentId` with `scanLimit: 200` | **49.8 ms** | 55.9 ms | **52.1 ms** | 61.0 ms |
| **`git log -n 20 -- <path>` (the real git CLI)** | **9.8 s** | — | **12.5 s** | — |

The git CLI is 2.6–2.8× faster than our walk and still takes ten to twelve seconds. This is inherent: Git has no reverse index from path to commits, so answering "what happened to this file" is a linear scan of the commit graph. `read` and `diff` are unaffected because they address objects directly — `read(path, HEAD)` is 1.56 ms p50 and `diff(revA, revB, path)` is 2.31 ms p50 at 1,000 documents (2.00 ms at 10,000).

The consequence is that ADR-015's Postgres revisions index is **not an optimisation, it is a requirement**. The content store's `history()` is a rebuild-and-verify path, and must carry a mandatory scan limit so a caller cannot accidentally block a request thread for half a minute.

Rebuilding the whole index from the repository is cheap enough to be a real recovery procedure: **6.50 s for 20,300 commits at 1,000 documents and 5.84 s at 10,000** (~3,100–3,500 commits/s), reading commit objects and their `Quill-Document-Id` trailers only.

### F8 — Repository size on disk, loose versus packed

| Repository | Loose | Files | After `git gc --prune=now` | Files | gc time |
| ---------- | ----- | ----- | -------------------------- | ----- | ------- |
| 1,000 docs (~2 MB of Markdown), 20,300 commits | 33.9 MB | **143,393** | **19.8 MB** | 12 | 91.7 s |
| 10,000 docs (~20 MB of Markdown), 20,300 commits | 60.0 MB | **155,789** | **23.1 MB** | 12 | 109.1 s |

Two things to read off this.

**The file count, not the byte count, is the operational problem.** Every publish creates 5–7 new loose objects (one blob, four or five trees, one commit) — 20,300 revisions produce ~143,000 files whether the repository holds 1,000 documents or 10,000. That is what degrades publish p95 by 6× (F5), what makes backups and container layers miserable, and what `git gc` fixes: 143,393 files become 12.

**Delta compression is doing less than it looks.** 33.9 MB → 19.8 MB is only a 42 % reduction, because this corpus is pessimistic for deltas: the generator changes text in every paragraph of every revision. Real documents, where a revision edits one paragraph, will pack far better — but the honest number from *this* corpus is 42 %, and the write-up should not claim more.

Packing is also what makes the history walk survivable: after `git gc` the 1,000-document repository's 143,393 objects live in one 19.8 MB file, which the OS keeps in page cache.

### F9 — The repository is readable by the real `git` CLI

85 checks in `test.ts` and 14 in `test-edge.ts`, all green. The ones that matter:

- `git fsck --strict` reports nothing. (Run with `--no-dangling`: a publish that loses its CAS leaves an unreferenced commit behind, exactly as the git CLI does. Garbage, not corruption.)
- `git log`, `git show <rev>:<path>`, `git cat-file`, `git diff <a> <b>`, `git rev-list` all work.
- `git log --format=%(trailers:only)` parses `Quill-Document-Id` and `Quill-Change-Note`.
- `git log -- <path>` returns exactly the same revisions as our `history()`.
- The committer is `Quill <quill@quill.invalid>` and the author is the publishing user, as ADR-014 requires.
- `git clone` produces a working tree with the expected content — a user can clone the content store.
- A bulk import of 500 documents produces exactly one commit and 500 files (ADR-015's bulk rule). At benchmark scale a single-commit import of 1,000 documents took 1.62 s and 10,000 documents took 13.0 s.
- `git read-tree` + `git write-tree` on one of our trees reproduces the identical tree oid, which is the strongest available check that our tree ordering matches git's (subtrees sort as if their names ended in `/`).

### F10 — A packfile *reader* is mandatory, not optional

After `git gc --aggressive --prune=now`, every loose object is gone. A loose-object-only implementation stops working the moment an administrator runs `git gc`, a backup script runs `git repack`, or the repository is created by `git clone`. The spike therefore implements a pack-index v2 and packfile reader including `ofs_delta` and `ref_delta`, ~150 lines, and `test.ts` verifies that `read`, `history` and `publish` all keep working against a fully packed repository, and that `git fsck` is still clean after we write loose objects on top of packs.

Writing packfiles is only needed for the Git wire protocol (ADR-014's opt-in remote sync). On the filesystem backend that can be delegated to the git CLI. On the Postgres/S3 backend it cannot, which is where the work is (see the object-layer sketch below).

### F11 — Three-way Markdown merge: use `node-diff3`, do not shell out

| Approach | Cost per merge (1 KB document) | Notes |
| -------- | ------------------------------ | ----- |
| `node-diff3` 3.2.1 | **0.011 ms** | Zero dependencies. 25.0 ms on a 4,000-line document. |
| `diff3` 0.0.4 | 0.016 ms | Works, but unmaintained at 0.0.x. |
| `git merge-file` (spawn + 3 temp files) | **39.56 ms** | 3,600× slower, needs a writable temp directory, needs git installed on the server, and cannot run against the Postgres/S3 backend at all. |

`node-diff3`'s output is **byte-identical** to `git merge-file -p --diff3`, including the conflict markers, verified in `merge-demo.ts`. Demonstrated cases:

- **Two non-overlapping edits** (Ada rewrites the prerequisites paragraph, Ben adds a troubleshooting line): merges clean, both edits present, zero conflicts.
- **Two edits to the same line** (`3. Run \`pnpm start\`…` vs `3. Start the server with \`quill serve\`.`): one conflict, with the same three-way markers git produces. This is the case ADR-015 sends to the merge view.
- **Two different appends at the end of the document**: a conflict in `node-diff3` *and* in `git merge-file`. Line-based merge cannot tell two adjacent insertions apart. ADR-002's AST opens the door to a smarter block-level merge later, but line-based is the right first implementation and matches what users expect from Git-shaped tooling.

Shelling out is rejected on all four counts: latency, a git binary as a runtime dependency, temp-file handling, and incompatibility with the object-storage backend.

### F12 — Windows-specific hazards found while building it

These are implementation rules, not engine criteria, but they would have been bugs found in production.

1. `rename()` over a destination another handle has open fails with `EPERM` on Windows. The ref update needs a bounded retry with backoff; git-for-windows does the same thing internally.
2. Opening the lockfile with `O_EXCL` can fail with `EPERM` rather than `EEXIST` when a previous holder has just unlinked it and the file is in "pending delete". It must be treated as contention, not as an error.
3. **Eight concurrent publishers with immediate CAS retry livelock.** Every loser retries instantly, collides again, and the unlucky publisher starves past any sane attempt limit. Jittered exponential backoff between attempts fixes it; the spike's `publish` does `1 + rand(min(2^attempt, 64))` ms.
4. Publishes into the same workspace should additionally be serialised inside the process. Retrying a publish means re-reading the tree and re-writing 5 trees and a commit, all of which become garbage — a queue in front of the ref is cheaper than the retries.

### F13 — Trailer and Unicode encoding rules

- Change notes are free text and may contain newlines; a Git trailer value is one line. The spike folds newlines to spaces on write, and `git log --format=%(trailers:key=Quill-Change-Note,valueonly)` reads the folded value back intact. Git itself *does* support folded continuation lines (a following line indented with whitespace) and `unfold` reads them — so multi-line notes can be preserved. But a naive trailer reader written the obvious way (ours) does not merely drop the continuation: parsing backwards from the end of the message, the first unmatched line ends the trailer block, so **a folded value makes the reader return an empty trailer set and lose `Quill-Document-Id` as well**. That is an index-rebuild failure caused by a user pasting a paragraph into a change note. Fold on write, or unfold on read, but do not leave it undecided.
- Unicode in document titles, author names, change notes and paths round-trips through commit objects and tree entries unharmed, and `git fsck --strict` stays clean. Paths are stored as raw UTF-8 bytes; no normalisation is applied, which means a macOS client that hands us NFD and a Linux client that hands us NFC would produce two different paths for the same name. Normalise to NFC at the application boundary.

## Options

| Option | Strengths | Weaknesses | Rewrite risk if wrong |
| ------ | --------- | ---------- | --------------------- |
| **Hand-written object model on `node:zlib` + `node:crypto`** | Zero dependencies. Six-method `ObjectStore` port that Postgres and S3 implement directly. Fastest of the three (10.5–11.0 ms p50 on disk, 0.11 ms of actual work). Native zlib and SHA-1. CAS written to git's own lockfile protocol. Nothing to keep compatible with Node releases. | We own the encoding, including tree ordering, packfile reading, and eventually packfile writing for the Git wire protocol. About 700 lines to maintain, plus tests. A mistake here corrupts repositories. | **Low.** The format is frozen and thirty years old, the `ObjectStore` port is the seam, and `git fsck` plus `git read-tree`/`write-tree` are a complete oracle in CI. If it turns out badly, `isomorphic-git` slots in behind the same `ContentStore` interface. |
| **`isomorphic-git`** | Mature, widely used, handles packfiles, the wire protocol, clone/fetch/push, and rename detection today. All bare-repo primitives present. Produces repositories `git fsck --strict` accepts. Would save the packfile work. | 20–45 % slower on publish, 78 % slower on read. No ref CAS — the most safety-critical operation must be hand-written anyway. Backend pluggability is a POSIX-filesystem shim, not an object store, so ADR-014's Postgres/S3 backend is emulation. 55 packages; re-implements zlib (`pako`) and SHA-1 (`sha.js`) in JS on a runtime that has both natively. | **Medium.** Swapping it out later is contained by the `ContentStore` interface, but anything built on the `fs`-shim backend (the object-storage deployment) would be thrown away. |
| **`nodegit` (libgit2)** | The real libgit2. Real ref CAS. Packfiles, wire protocol, rename detection, everything. Does build and load on Node 24. | `pnpm` refuses to install it. 115 MB, native, alpha-versioned. 3.5× slower than the hand-written model on the same corpus (38.8 ms vs 10.96 ms p50). **`OdbBackend`/`RefdbBackend` are not exposed, so ADR-014's Postgres/S3 backend is impossible without writing C++.** `Merge.file` missing. Native rebuilds on every Node major. | **High.** It forecloses the object-storage backend, which is one of ADR-014's two named deployment targets. Discovering that after the filesystem backend ships is a rewrite of the storage layer and of every deployment that depends on it. |
| **Do not use Git at all; revisions in Postgres** | Simplest history query. | Already rejected in ADR-014: two revision models, and the product promises a repository users can clone. The spike confirms clone works. | n/a |

## Recommendation

**Write the object model.** Implement `packages/content-store` on the hand-written Git object model over the six-method `ObjectStore` port, with a filesystem backend (loose objects, packfile reader, lockfile CAS) first and a Postgres/S3 backend behind the same port.

The reasoning is not performance — on a filesystem backend all three engines are dominated by file I/O and any of them would meet the budget. It is that ADR-014 names two storage backends, and **only the hand-written model can actually have both**. `nodegit` forecloses the object-storage backend outright; `isomorphic-git` reaches it only by pretending Postgres is a filesystem. The thing we would be buying from either library — packfile handling and the wire protocol — is exactly the part we do not need until remote sync ships, and the part the git CLI can do for us on the filesystem backend in the meantime. The thing we would still have to write ourselves in both cases — compare-and-swap on refs — is the part where correctness actually matters.

Use **`node-diff3`** for the three-way merge, not `git merge-file`.

One thing the spike changes about how the recommendation is *operated* rather than chosen: on the filesystem backend, loose-object accumulation — not the engine, not the document count, not the history depth — is the only thing that degrades publish latency, and it shows up in the tail long before the median. Whichever engine were chosen the fix is identical and it is an operations task: pack the repository on a schedule, and alert on publish p95 rather than p50.

**What would change this recommendation:**

- If `isomorphic-git` gained a genuine object-store backend interface (get/put by oid, CAS refs) rather than an `fs` shim, it would become the better choice: we would inherit packfile writing and the wire protocol for free, at a 20–45 % latency cost that is invisible next to disk.
- If remote Git sync (ADR-014's third backend) is pulled forward into the MVP, the balance shifts toward `isomorphic-git`, because packfile *writing* and `git-upload-pack`/`git-receive-pack` are substantial and it already has them.
- If `git fsck` ever disagrees with a tree we wrote, in CI, on any platform, stop and reconsider.

## Consequences

**Commits us to:**

- Owning ~700 lines of Git object encoding (332 + 371 in the spike), with `git fsck --strict` and a `git read-tree` / `git write-tree` round trip as mandatory CI checks on every platform we support. The spike's `test.ts` is the starting point.
- Writing a packfile reader before the first release (done in the spike), and a packfile writer before remote sync ships. Until then, `git gc`, `git repack` and `git push` on the filesystem backend are delegated to the git CLI as an operational task, not a product feature.
- A hard rule that nothing above `ContentStore` calls `history()` without a scan limit.
- **Scheduled `git gc` as a first-class operational requirement of the filesystem backend, not a nice-to-have.** Publish p95 degrades roughly 6× per 20,000 revisions as loose objects accumulate, and recovers to 12 ms after packing (F5, F8). This belongs in ADR-018/024 and in the deployment docs; the maintenance job must take the same ref lock the store uses, and the store must keep reading correctly while `gc` runs (verified in `test.ts`).

**Makes easier:**

- The Postgres/S3 backend: six methods, no filesystem emulation, and the round-trip count is known (6 reads, 7 writes, 1 ref read, 1 CAS per publish).
- Testing: the in-memory store makes the whole content store testable with no temp directories and no I/O — 0.11 ms per publish means thousands of publishes in a unit test.
- Deployment: no native addon, no `node-gyp`, no rebuild on Node majors, no 115 MB dependency, and `pnpm install` keeps working.

**Makes harder:**

- Anything that needs the Git wire protocol. Remote sync will need packfile writing, or a shell-out to git on filesystem deployments and a genuine implementation for object storage.
- Rename detection. `git log --follow` exists; we do not have it. ADR-015 sidesteps this by following the document ID rather than the path, which is the better answer anyway, but we cannot fall back on Git's similarity detection for imported repositories.

## Object layer on Postgres or S3 (sketch)

The port is `read`/`write`/`has`/`readRef`/`casRef`/`writeBatch`. Objects are content-addressed and therefore immutable and idempotent to write; refs are the only mutable state, and the only place concurrency lives.

**Postgres.**

```sql
create table git_objects (
  repo_id  uuid     not null,
  oid      bytea    not null,          -- 20 raw bytes
  type     smallint not null,          -- 1 commit, 2 tree, 3 blob, 4 tag
  size     integer  not null,          -- inflated size
  body     bytea,                      -- deflated body, or null when in S3
  s3_key   text,                       -- set when body exceeds the inline threshold
  primary key (repo_id, oid)
);

create table git_refs (
  repo_id    uuid   not null,
  name       text   not null,
  oid        bytea  not null,
  version    bigint not null default 1,   -- CAS column
  updated_at timestamptz not null default now(),
  primary key (repo_id, name)
);
```

- `write` is `insert … on conflict (repo_id, oid) do nothing` — idempotent by construction, so retries and duplicate publishes are free. `writeBatch` is one multi-row insert, which turns the seven writes per publish into one round trip.
- `casRef` is `update git_refs set oid = $next, version = version + 1 where repo_id = $r and name = $n and oid = $expected returning version`. Zero rows affected means the ref moved: return `false` and let the existing retry loop handle it. An unborn ref is `insert … on conflict do nothing`, and zero rows means someone else created it first.
- The `version` column is not strictly needed when comparing on `oid`, but it makes "the ref moved and came back" observable and gives the revisions index something monotonic to follow.
- Blobs bigger than an inline threshold (say 1 MB) go to S3 with the row keeping `s3_key`, so large attachments do not bloat the table.

**S3-compatible object storage.**

- Objects at `objects/<repo>/<oid[0:2]>/<oid[2:]>`, written with `If-None-Match: *` so a write is create-only and concurrent identical writes cost nothing.
- **Refs do not belong in S3.** Even with conditional writes, the ref is the one place a lost update is data loss; keep `git_refs` in Postgres even when objects are in S3. A deployment with no Postgres at all would need DynamoDB or an equivalent conditional-put store, and that should be a separate decision.
- The latency arithmetic is the thing to design against. Six reads and seven writes per publish at ~20 ms per S3 round trip is ~260 ms serial. Two changes fix it: trees and commits are immutable, so an in-process LRU serves almost every read (measured: the same cache cuts filesystem publish from 11.26 ms to 8.89 ms, and the *tree* reads are the part it eliminates); and the seven writes are independent, so they issue in parallel as one batch. That gives roughly one write round trip plus one CAS — on the order of 60–80 ms — which is an acceptable publish latency for a cloud deployment. Against Postgres on the same network it is closer to 15 ms.

**Where packfiles matter.**

1. **Clone and fetch.** The Git wire protocol transfers a packfile. On the filesystem backend `git-upload-pack` does this for us. On Postgres/S3 there is no git process to hand the repository to, so serving a clone means generating a packfile from the object store — expensive enough that it needs a cache keyed on the ref value, and probably a background job that maintains a "base pack" for the whole history plus a thin pack for recent commits.
2. **Storage efficiency.** Loose objects store every revision of every document in full. A 2 KB Markdown file edited twenty times is twenty deflated copies. Delta compression is what makes a document repository's history cheap, and it only exists inside packfiles. On Postgres/S3 this means a periodic repack job, or accepting a storage bill proportional to revisions × document size.
3. **Read amplification.** A history walk is one object read per commit. Packed, those reads come from one open file; in S3 they are one GET each. This is another reason the Postgres revisions index is mandatory rather than nice to have (F7).
4. **Object count.** The filesystem backend creates 5–7 loose files per publish, four of them small trees. 20,300 revisions of 1,000 documents produced **143,393 loose files**. NTFS does not fully cope — publish p95 degrades 6× before the median moves (F5) — and backup tools and container image layers cope less well still. This alone makes scheduled `git gc` an operational requirement rather than hygiene (ADR-018/024).

## Should ADR-014 be accepted as written?

**Accept with revisions.** The shape of ADR-014 survives the spike intact — bare repository, no working directory, one branch, a `ContentStore` interface in document vocabulary, publish as blob + tree + commit + CAS, trailers so the index can be rebuilt, filesystem and object-storage backends. Every one of those was implemented and measured, and `git fsck --strict` accepts the result. Six things should change before it moves to Accepted.

1. **Name the engine.** Replace "a Git-compatible object engine used as a library" with the decision: *a Git object model implemented in `packages/content-store` over an `ObjectStore` port of `read`, `write`, `has`, `readRef`, `casRef`, `writeBatch`; no third-party Git library.* Record `nodegit` and `isomorphic-git` in "Alternatives considered" with the reasons from F3 and F4 — in particular that `nodegit` cannot express the object-storage backend at all.

2. **Add the packfile requirement.** State that the content store must *read* pack-index v2 and packfiles including deltas from the first release, because `git gc`, `git clone` and any external tooling produce them; and that it must *write* packfiles before remote sync ships. Without this sentence the object-storage backend looks cheaper than it is.

3. **Correct the performance clause and record the measurement.** The current text says R4 "measures publish latency and history cost at 10,000 documents and 100,000 commits". It was measured at 10,000 documents and 20,000 commits. Publish is flat in document count and in history depth (10.5–11.0 ms p50 at 31 commits and at 20,000), so extrapolating *publish* to 100,000 commits is safe **provided the repository is packed**; the unpacked p95 curve is not safe to extrapolate and the honest statement is "degrades ~6× per 20,000 unpacked revisions". History is linear in total commits — 27.6 s (1,000 docs) and 33.1 s (10,000 docs) at 20,000 commits, extrapolating to roughly 140–165 s at 100,000 — so that clause should record the finding rather than state a target.

   Add one more operational requirement while editing this clause: **`git gc` on a schedule for the filesystem backend.** It is the difference between 12 ms and 71 ms publishes and it is not optional.

4. **Make the revisions index a requirement, not a cache.** ADR-014 currently presents the Postgres index as the thing the trailers let us rebuild. Add the converse: history from the repository is O(total commits) and unusable interactively — the real `git log -- <path>` takes 9.8 s on this corpus — so the index is on the critical path for the history and compare features, and `ContentStore.history()` must take a mandatory scan limit. Index rebuild is measured at ~3,100 commits/s, which makes it a viable recovery procedure.

5. **Specify the concurrency rules.** "Advances the ref with compare-and-swap, retrying on contention" is not enough. Add: CAS is the lockfile protocol on the filesystem backend and a conditional update on the database backend; retries use jittered backoff (immediate retry livelocks under eight concurrent publishers); publishes to one workspace are serialised in-process ahead of the CAS; and losing a CAS leaves an unreferenced commit, which is expected and collected by `gc`.

6. **Specify the trailer and path encoding.** Change-note trailers are single-line — state whether Quill folds newlines to spaces (simplest) or writes folded continuation lines and unfolds them on read. This is not cosmetic: a folded value read by a naive trailer parser loses the *entire* trailer block, `Quill-Document-Id` included, which breaks the index rebuild that revision 4 above makes load-bearing (F13). State also that paths are UTF-8 and normalised to NFC at the application boundary.

Two things ADR-014 says that the spike **confirms and should keep unchanged**: the human-readable on-disk layout (a clone produces exactly the directory tree in section 9.5, and `git show`/`git log` read it), and keeping drafts out of the content store (ADR-021) — at 10.5 ms and 5–7 new objects per publish, a revision per autosave would be ruinous in both latency and object count.

## Resulting ADR

Feeds [ADR-014](../architecture/decisions/0014-content-store.md) (accept with the six revisions above) and confirms [ADR-015](../architecture/decisions/0015-versioning-and-publish-semantics.md), which needs no change: publish-as-only-write, stale-base three-way merge, restore-as-new-revision and one-commit bulk operations were all implemented and measured against it.
