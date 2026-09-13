# R4 — Content store spike

Throw-away prototype for research item R4. The finding lives in
[`docs/research/r04-content-store.md`](../../docs/research/r04-content-store.md);
this file records the question, what was tried, and how to reproduce the numbers.

## Question

Which Git engine should implement the ADR-014 content store against a **bare**
repository with no working directory and no index —
[`isomorphic-git`](https://isomorphic-git.org) (pure JS),
a libgit2 binding such as [`nodegit`](https://www.nodegit.org) (native),
or a small object model written against `node:zlib` and `node:crypto`?

The decisive criteria, in order:

1. Can it write blobs, trees and commits and advance a ref **without a working
   tree or index**?
2. Does it survive Node 24 (native TypeScript, no build step)?
3. Can the object read/write layer be **swapped for Postgres or S3** — ADR-014
   commits us to that backend, and a library that only knows about POSIX
   filesystems makes it a rewrite rather than a new class.
4. Is publish latency acceptable at 10,000 documents and 20,000 commits?

## What was tried

| # | Thing tried | Where |
|---|---|---|
| 1 | Hand-written object model: SHA-1 identity, loose-object encoding, tree/commit encoding and decoding, tree ordering, trailers | `src/git-core.ts` |
| 2 | Filesystem backend: loose objects, lockfile compare-and-swap on refs, reflog, **and a packfile reader** so the store survives `git gc` | `src/fs-store.ts` |
| 3 | Key/value backend + a read-through cache, standing in for Postgres/S3 and counting the round trips a real one would make | `src/memory-store.ts` |
| 4 | The ADR-014/ADR-015 publish path, plus `read`, `history`, `historyByDocumentId`, `diff`, `listTree`, `rebuildIndex`, stale-base detection and CAS retry with jittered backoff | `src/content-store.ts` |
| 5 | The same publish path on `isomorphic-git`, for comparison | `src/isogit-store.ts` |
| 6 | `nodegit` (libgit2): install, Node 24 load, bare-repo publish path, ref CAS, and whether a custom object database backend is reachable from JS | `probe-nodegit/probe.ts` |
| 7 | Three-way Markdown merge: `node-diff3`, `diff3`, and shelling out to `git merge-file` | `merge-demo.ts` |
| 8 | 85 + 14 correctness checks, including `git fsck --strict`, `git log`, `git show`, `git clone`, and reading back through a packfile after `git gc` | `test.ts` |
| 9 | Publish-cost breakdown: disk, disk + cache, and pure in-memory, to separate engine cost from Windows file I/O | `profile.ts` |
| 10 | Benchmarks at 1,000 and 10,000 documents and 20,000 commits | `bench.ts` |
| 11 | Edge cases that set encoding rules: multi-line change notes, Unicode paths and authors, awkward tree ordering, empty documents | `test-edge.ts` |
| 12 | Diagnosis of the publish slowdown seen at 10,000 docs / 20,000 commits — is it the engine, the filesystem, or the benchmark itself? | `scale-check.ts` |

## How to run

Node 24 or newer. The spike is **not** a workspace package; install with
`--ignore-workspace` so the root lockfile is untouched.

```bash
cd spikes/r4-content-store
pnpm install --ignore-workspace

node test.ts                       # 85 correctness checks, ~30 s
node merge-demo.ts                 # question 5: three-way merge
node profile.ts                    # where a publish spends its time
node bench.ts --docs 200 --commits 400 --samples 50     # quick
node bench.ts --docs 1000,10000 --commits 20000 --out results-own.json   # the real run, ~25 min
node bench.ts --engine iso --docs 1000 --commits 20000  # isomorphic-git comparison
node test-edge.ts                  # encoding edge cases
node scale-check.ts --store memory # engine cost curve, ~3 s
node scale-check.ts --store fs     # filesystem cost curve, ~5 min
```

`bench.ts` flags: `--docs a,b`, `--commits N`, `--samples N`, `--engine own|iso`,
`--out file.json`, `--keep` (do not delete the temp repositories).

Everything is written under the OS temp directory and removed afterwards.

### nodegit probe

`nodegit` **cannot be installed by pnpm at all** — it depends on `nan` resolved
via a git URL, which pnpm refuses in a subdependency
(`ERR_PNPM_EXOTIC_SUBDEP`). It therefore lives in its own directory installed
with npm, and is deliberately not a dependency of the spike:

```bash
cd spikes/r4-content-store/probe-nodegit
npm install                        # ~48 s, 151 packages, 115 MB
npm rebuild nodegit --foreground-scripts   # npm 11 blocks install scripts by default
node probe.ts
```

## Finding, in one paragraph

Write the object model. It is about 700 lines (332 of object model, 371 of filesystem backend), has zero dependencies, runs the
ADR-014 publish path in **0.11 ms of actual work** per publish, and is the only
one of the three options whose storage layer is a six-method interface that a
Postgres or S3 backend can implement directly. `isomorphic-git` does everything
required against a bare repo but is 20–45 % slower on publish, pulls 54 transitive
packages, re-implements zlib and SHA-1 in JavaScript, has **no
compare-and-swap on refs**, and its pluggability story is "inject an object that
impersonates a POSIX filesystem" rather than an object store. `nodegit` builds
and loads on Node 24 and is the only option with a real CAS primitive
(`Reference.createMatching`), but it is 3.5× slower than the hand-written model,
cannot be installed by our package manager, ships a 115 MB native dependency,
and — decisively — does not expose `git_odb_backend`, so ADR-014's
Postgres/S3 backend cannot be written from JavaScript at all.

The one number that changed the write-up after it was first drafted: `bench.ts`
measured publish p50 at 71 ms for the 10,000-document repository at 20,000
commits, seven times the 10.96 ms it measured at 31 commits. `scale-check.ts`
shows that neither the engine nor the repository is at fault — against an
in-memory store the same workload is flat at 0.10 ms from commit 1 to commit
20,000, and in a fresh process on a fresh volume the filesystem run only drifts
from 11.96 ms to 16.82 ms p50. What actually degrades is the **95th percentile**
(14.9 ms to 89.4 ms) once the repository passes ~100,000 loose objects, and it
degrades further when another large loose-object tree shares the volume, which is
what `bench.ts` accidentally arranged. `git gc` returns it to 12 ms. Scheduled
packing is therefore an operational requirement of the filesystem backend, and
publish should be alerted on p95, not p50.

Full numbers, options table, and the recommendation on ADR-014 are in the
research write-up.
