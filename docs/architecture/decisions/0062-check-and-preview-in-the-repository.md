# ADR-062: Check and preview in the repository

**Status:** Proposed
**Date:** 2026-11-10
**Related:** quill-plan.md sections 7, 9.5, 14, 31 and 33; ADR-011 (security baseline), ADR-014 (content store), ADR-023 (public site), ADR-028 (theming), ADR-030 (syntax highlighting), ADR-031 (render caching), ADR-033 (compatibility), ADR-036 (drawings), ADR-042 (link previews), ADR-047 (images), ADR-058 (navigation blocks), ADR-060 (component blocks), ADR-061 (read-only external Git sources); AGENTS.md rules 3, 9, 13 and 19

## Context

ADR-061 lets a workspace read its documents from a repository. Its manifest (`.quill/workspace.yaml`) names the collections; folders become documents; relative links and images resolve at render; repository assets are imported through the upload pipeline; the sync job replays first-parent commits. Problems are found by the sync and shown on the source's admin page: an invalid manifest with its line, refused files and why, broken relative links, and, since ADR-060, `block-issue` signals from the render.

So the people who write those documents have no inner loop. They cannot see a page before they push it, and a pull request cannot be checked for Quill problems until it has merged and synced. The owner wants that inner loop without making Quill a dependency of the repository: the documents stay plain Markdown, and removing the tool changes nothing about them.

Lockstay, the first repository Quill reads, shows what authors rely on today:

- **`pnpm docs:check`** (`scripts/docs/`, about 1,300 lines with its tests). It checks links and their anchors, front matter, raw HTML, the block directives it allows (`scripts/docs/blocks.ts` lists `timeline`, `step`, `cast`, `checks` and `details`) and manifest coverage. It prints `path:line: message` and exits 1 on any problem. It reads the files Git tracks or would track, so a link that resolves only on a case-insensitive disk still fails. On lockstay's 486 pages it takes 3.7 seconds.
- **`apps/docs`**, a static build with `marked` and the kit's tokens, served by `vite preview` on port 4320. It does not watch: an author rebuilds to see a change.

Both are a second renderer and a second checker. Neither can say what Quill will do, which is why ADR-060 had to bring Quill's blocks to parity with lockstay's renderer before Quill could serve those pages.

Facts of the code that shape the answer:

- **The planning is pure and already shared once.** `source-manifest.ts`, `source-layout.ts`, `source-folders.ts`, `source-links.ts`, `source-assets.ts` and `source-files.ts` in `@quill/application` are pure. The source settings preview is extracting `source-plan.ts` (reading a revision's layout, accepting a document, reading its contents) so the preview and the sync place files the same way. `sync-source.ts` (1,850 lines) still interleaves the remaining decisions with its writes.
- **Rendering is a pure function behind a port.** `DocumentFormat.render(input)` is implemented in `apps/server/src/infrastructure/markdown/document-format.ts` over `@quill/markdown`. The cache key is `renderCacheKey(hash(renderDigest(input, registry.signature)))` with `RENDER_VERSION` (16 today) (ADR-031).
- **The reading page is plain functions.** The public site's templates (`apps/server/src/public-site/templates`), its stylesheet and the theme stylesheet (`apps/server/src/theme/theme-stylesheet.ts`) are plain TypeScript over `@quill/design-css`, with no React. The reader preview already renders through the same page template.
- **The asset pipeline needs no native code.** Sniffing, the allowlist, the size cap and metadata stripping (`attachments.ts`, `image-metadata.ts`) are TypeScript. `sharp` is used only by the server's image variants and link-preview transcoding (ADR-047, ADR-042).
- **Rendering is CPU-bound, and parsing is most of it.** Measured on 10 November 2026 on the development machine (Ryzen 9 5900X, Node 24.22, rendering from TypeScript source through `createDocumentFormat`) over lockstay's `docs/`: 486 Markdown files, 18.2 MB, median 14 KB, 95th percentile 150 KB, largest 870 KB.
  - One thread, cold: 30 to 56 seconds. With the JIT warm: 19 seconds. Parsing alone, with no rendering, also took 19 seconds, so nearly all of the cost is parsing. That is about 1 MB of Markdown a second.
  - Per file: median 44 ms, 95th percentile 454 ms, largest 2.0 seconds.
  - Importing the pipeline from TypeScript source: 2.7 seconds. Bundled with rolldown it is one 1.2 MB file, 368 KB gzipped.
  - A pool of 4 worker threads: 7.5 seconds wall, about 1.1 GB resident in total, up to 230 MB heap per worker. A pool of 8: 7.7 seconds and twice the memory, because the largest files and the import set the floor.

## Decision

A command-line tool, `quill`, with two commands, `quill check` and `quill preview`, run inside the repository. It plans and renders the working tree with the same code the server's sync and renderer run, imported, not copied, and a parity suite proves the two agree.

### 1. Scope

**`quill check`** reports what a sync of the working tree would report, and nothing else:

| Code | Severity | What it is | Where the server has it |
| --- | --- | --- | --- |
| `manifest-invalid` | error | The manifest does not read, with its line (`ManifestProblem`) | Sync failure `invalid-manifest` |
| `manifest-entry` | error | The manifest describes several workspaces and none was chosen, or the chosen one is missing | Sync failure `invalid-manifest` |
| `manifest-unknown-key` | warning | A key this version does not read, with its line | `SourceLayoutRecord.unknownKeys` |
| `file-too-large`, `file-not-utf8`, `file-symbolic-link` | error | A document file the sync refuses | `RefusedSourceFile` |
| `asset-type-not-allowed`, `asset-type-mismatch`, `asset-empty`, `asset-malformed`, `asset-too-large` | error | An asset the upload pipeline refuses (ADR-011, ADR-047) | `RefusedSourceFile` |
| `link-broken` | warning | A relative link to a path that is not in the repository | `BrokenSourceLink` |
| `block-issue` | warning | An unknown block, a prop that does not fit, a block that cannot be drawn (ADR-060) | `RenderedContent.blockIssues`, the `block-issue` health signal |
| `required-section-empty` | warning | A required section left empty | The `required-section-empty` health signal |
| `version-drift` | warning | The tool's version is outside the manifest's `requires` range (section 6) | The source's admin page (section 6) |
| `left-out` | note | A file under a collection's path that `exclude` or the layout leaves out, with the pattern | The settings preview's skipped files |
| `folder-generated`, `folder-index`, `folder-shared` | note | A folder given a generated document, the file chosen as a folder's document, a folder two collections share (ADR-061, amendment of 9 November) | The folder plan |

**The rule:** the tool reports every problem that is a function of the repository's content and that the server records, and no other. It adds no check of its own. A check worth having (heading anchors, front matter fields) is added to the shared code, so the admin page shows it too, and the tool reports it from then on. Signals that depend on the instance or the clock (`no-owner`, `review-overdue`) are not reported.

The report also carries the tree the sync would build: each collection with its documents, folders and generated folder documents, titled and ordered as the sync orders them. This is the same tree the source settings preview returns.

**`quill preview`** serves the working tree through Quill's renderer and the public site's page template and stylesheet (ADR-023, ADR-028), reloading a page when a change affects it. Each page lists its own problems from the same report, above the body, and `/_preview/problems` lists them all.

**Out of scope:** accounts, permissions, comments, search, history and revisions, drafts, publishing, the public site's addresses and sitemap, link previews' fetched cards (section 5), and talking to an instance. The tool never writes to the repository.

### 2. One truth

**The tool imports the server's planning and rendering code.** Nothing in it decides where a file goes, whether it is refused, where a link leads or how a page is drawn.

**Shared code it imports:**

- **`@quill/application`: the plan and the report.**
  - The planning modules listed in Context, and `source-plan.ts` once the settings preview lands it.
  - One new function, `planSourceHead(source, revision, options)`, returns a `SourcePlan`. That is every decision the sync makes about one revision's files: the layout, each document's collection and parent, folder documents, refused files with reasons, left-out files with patterns, assets with their intake verdicts, and each document's resolved relative links and images.
  - One new function, `reportSource(plan, rendered)`, returns a `SourceReport` from a plan and the rendered bodies.
  - **The sync job is rewritten to take the plan's decisions.** Its write path stores what the plan says and decides nothing about a file. A branch in the write path that decides a file's fate is a defect, because the tool cannot see it.
  - The settings preview builds its answer from the same plan.
  - The asset intake that decides (`receiveFile`'s sniffing, allowlist, size cap and metadata stripping) is already pure and is used as it is.
- **`@quill/format` (new package): the `DocumentFormat` adapter.** `document-format.ts`, `document-title.ts`, `required-sections.ts` and `highlighter.ts` move out of `apps/server/src/infrastructure/markdown`, and the drawing text reader out of `apps/server/src/extensions/drawio`. The server imports them from the package. This changes no behaviour, and the server's tests move with the files.
- **`@quill/site` (new package): the reading page.** `public-site/html.ts`, `public-site/templates/`, the document page from `pages.ts`, `public-site/stylesheet.ts`, the scheme and reader scripts, and `theme/theme-stylesheet.ts` move out of `apps/server`. The server keeps its routes, cache, invalidation, sitemap and search page.
- **`@quill/markdown`**, through `@quill/format`, with its block registry (`createMarkdownRegistry`) and the link rewrite (`render/rewrite-links.ts`), and **`@quill/design-css`** for the styles.

**Adapters for the tool's ports:**

- **`WorkingTreeSource`**, an `ExternalSource` over the working tree, in `packages/content-store/src/external-source/`.
  - A file's id is its Git blob id, computed from its bytes. An unchanged file therefore has the same id in the working tree and at a revision.
  - `head()` is a digest of the sorted `(path, file id)` listing, so equal trees are equal revisions. `history` is that one revision, and `changes(null, head)` adds every file.
  - It honours `narrow`: contents are read only under the cone, as on the server.
  - `present()` answers from names only: Git's index when `git` is available, otherwise directory listings. It compares names case-sensitively against the listing and never asks the disk whether a path exists. On a case-insensitive disk `./Setup.md` is broken when the file is `setup.md`, as it is on the server.
- **`LocalRevisionSource`**, an `ExternalSource` over a revision of the local repository, for `--rev`. It sits beside the first adapter and reuses `git-cli.ts` and `git-output.ts`, hardened as in ADR-061: arguments as an array with no shell, no system or global configuration, no hooks, `-c protocol.allow=never` and `GIT_NO_LAZY_FETCH=1`, so a partial clone never fetches.
- **In `apps/cli`, the composition root:**
  - an in-memory path map that mints ids as name-based UUIDs (version 5) of the repository path, so bodies are cached across runs;
  - a disk render cache behind the shape of the render-cache port (section 4);
  - a worker-thread pool that runs `@quill/format`;
  - a `node:http` preview server whose routes call application functions only (AGENTS.md rule 3);
  - the watcher.

**Nothing above the content store knows about Git** (AGENTS.md rule 9). The composition root never runs `git` itself. The origin URL and `HEAD`, used for forge links, come from a helper exported by `@quill/content-store`.

**Dependency rules** added to `.dependency-cruiser.cjs`:

- `cli-is-not-the-server`: `apps/cli` imports nothing from `apps/server` or `apps/web`.
- `cli-has-no-server-runtime`: `apps/cli/src` imports none of `pg`, `drizzle-orm`, `fastify`, `@fastify/*`, `sharp`, `@node-rs/*`, `nodemailer`, `aws4fetch` or `react`.
- `cli-uses-no-test-support`: production files in `apps/cli/src` import no `test-support` entry.
- `format-and-site-are-portable`: `packages/format` and `packages/site` import nothing from `apps/`, `content-store`, `search`, `ui` or `editor`, and none of the server runtime above.

The existing rules hold as they are: the plan stays in `@quill/application`, which imports no infrastructure, and the server keeps importing no UI.

**Parity is a test obligation.** The parity suite (`apps/cli/src/parity/`) runs fixture repositories through both sides:

- **Server side.** The fixture is committed to a temporary repository. `syncSource` reads it through the real `GitCliExternalSource` over a `file://` remote (allowed in tests, as for configuring), with in-memory repositories and a `GitContentStore` over `MemoryObjectStore`. Every document is then rendered through `renderDocument`. The report is built from what the sync persisted (refused files, broken links, the layout record, block issues on the stored bodies), which is what the admin page reads, not from the plan.
- **Tool side.** `quill check --format json`, and the HTML bodies through the preview's render path.
- **Asserted:**
  - the two reports are equal, field by field;
  - every body is byte-identical. Before comparing, document ids, attachment ids and the forge commit are replaced with placeholders keyed by repository path, through each side's own path map.
- **Each fixture also has a golden `expected.json`,** so a change to either side shows as a diff in review.
- **The fixtures cover:**
  - every manifest problem and every unknown-key case, single and multi-entry manifests, globs and `exclude`;
  - every asset verdict, including an oversized asset and an SVG with its own `<style>`;
  - every folder rule: `index.md` over `README.md`, a generated folder, a README beside an index, a folder shared by two collections;
  - links to files, to folders with and without a slash, with fragments, outside the cone (as forge and as text), broken, and climbing out of the repository;
  - every built-in block, an unknown block, a bad prop and a `within` violation;
  - symbolic links, non-UTF-8 files, a file over a lowered size cap, CRLF line endings, and a link whose case differs from its file;
  - a lockstay-shaped sample.
- **Where it runs.** It runs in `pnpm test` on Linux, and in the tool's CI job on Windows and macOS. One integration test in `apps/server` runs the lockstay-shaped fixture through the real composition (Postgres, the filesystem store, the source's admin API) and compares it with the tool's JSON, which catches drift in the persistence adapters.
- **A change to the sync's reporting, to `@quill/format` or to `@quill/markdown` that the suite does not cover is incomplete.**

**What cannot be known offline** is listed in the report's `assumptions` and never guessed. That is the organisation's theme (the preview uses the built-in default, or `--theme <built-in id>`), custom emoji and label names (ADR-037, ADR-038), blocks an administrator installed at run time (ADR-060 step 7), an instance's own overrides of the file and asset size caps, and the titles of native documents a sourced page links to by id. The parity suite therefore compares against an instance with default settings.

### 3. Distribution and footprint

- **Package and binary.** `apps/cli` is published as `@quill/cli` with a binary `quill`. Both are spelled through the brand module and renamed with the product (ADR-026). `quill` is the same binary ADR-060 names for `quill blocks`; this ADR defines `check` and `preview` and reserves the rest.
- **Use.**
  - `npx @quill/cli check` to try it.
  - In a repository, `pnpm add -D @quill/cli` pinned exactly, with a script such as `"docs:check": "quill check"`, so the lockfile fixes the renderer CI uses.
- **One release train.** The tool's version is the Quill release version, built from the same tag, so tool 1.4.2 plans and renders what server 1.4.2 does.
- **Node.** `engines` is `>=22.12`, the oldest line still maintained when this lands. The bundle targets Node 22. CI runs the tool's tests on Node 22, 24 and 26 on Linux, and on Node 24 on Windows and macOS. Content repositories do not have to match the server's Node 24.
- **No Postgres, no Docker, no native modules.** The only runtime is Node. `sharp` is not needed, because the tool never makes image variants: the preview serves an asset's stored bytes after the same metadata stripping. A native module needs an amendment to this ADR.
- **`git` is optional.**
  - Without it the working tree is read from the disk, and the report says `fileSet: disk`: an ignored file then counts as present.
  - With it, the file set is what Git tracks or would track (`ls-files --cached --others --exclude-standard`), matching lockstay's check. Symbolic links are known by Git's mode `120000`, so a Windows checkout with `core.symlinks=false` (which writes a link as a text file) agrees with the server. The origin URL and `HEAD` give forge links.
  - `--rev <revision>` requires `git`, version 2.30 or later. Only `rev-parse`, `ls-tree` and `cat-file --batch` are used. `git backfill` is not needed.
- **Bundled, with nothing to install.** rolldown (already the repo's bundler for the reader script) builds `dist/`:
  - `quill.js`: argument parsing and help only;
  - `check.js` and `preview.js`: planning, cache and server, with no Markdown pipeline;
  - `render-worker.js`: the pipeline;
  - `site/`: CSS, the reader and scheme scripts, and the default theme's fonts as Latin and Latin Extended `woff2` only.

  The package has no `dependencies`, no install scripts and no `.node` files.
- **Lazy loading.** The main thread never imports the Markdown pipeline. Only render workers do, and only when a render is needed, so a warm `check` with nothing changed starts no worker. The tool calls `module.enableCompileCache()` with a directory in its cache, so a second run skips compiling the bundle.
- **Size budget**, checked after `pnpm build` by `scripts/check-cli-package.ts`, in the same way `check:bundle` checks the reading route: the packed tarball is at most 4 MB, the unpacked package at most 12 MB, and the step also fails on any `dependencies` entry, install script or `.node` file.

### 4. Performance, with numbers

**Where the time goes.** Parsing is most of the cost (Context), so the design is: never parse a file twice, never parse an unchanged file at all, and parse in parallel.

**Incremental work.**

1. **Stat index.** For each repository root the cache keeps `(path, size, mtime in nanoseconds, inode or file index) → blob id`, as Git's index does. A file whose stat matches is not read. A file modified within a second of the index being written is always re-read (Git's racy-clean rule).
2. **Facts by blob id.** Per file: whether it decodes as UTF-8, its front matter title and order, its first H1, and its relative destinations (`relativeDestinations`). These depend only on the bytes and are computed in the worker that parses the file.
3. **Plan.** On every run, from the listing and the facts. It costs no parse.
4. **Bodies by render key.** Each document's render input is built exactly as on the server, and its key is `renderCacheKey(hash(renderDigest(input, registry.signature)))`. A body is rendered only when its key is not in the cache.

   The input holds the document's resolved links and images, so a page re-renders when, and only when:
   - its own bytes change; or
   - a link of its now leads somewhere else, because a target was added, removed, renamed or became a folder document.

   Editing a page's text does not re-render the pages that link to it, because the resolved address (`/d/<id>#anchor`) did not change. Child-pages blocks are slots filled when the page is assembled (ADR-058), so they never re-render a body.
5. **Worker pool.** Renders run on `worker_threads`.
   - Size: `min(availableParallelism() − 1, 4)`, at least 1, or `--jobs <n>`. Four, because eight was no faster and twice the memory (Context).
   - Order: largest file first, so the 2-second file does not start last.
   - One message per document. Results are merged by key, never in arrival order.

**The cache.**

- **Location.** `QUILL_CACHE_DIR`, or `--cache-dir`. Otherwise `$XDG_CACHE_HOME/quill`, `~/.cache/quill` on Linux, `~/Library/Caches/quill` on macOS, and `%LOCALAPPDATA%\quill\Cache` on Windows. The name comes from the brand module. It is never inside the repository, so the working tree is never written and needs no ignore rule. `--no-cache` turns it off.
- **Keys.** The cache is split by `<tool version>/r<RENDER_VERSION>-<registry signature hash>/`, so a new tool, a new renderer or a different block registry never reads another's entries.
  - Within that: `stat/<root digest>` (one file per repository), `facts/` and `bodies/` (content-addressed), and `assets/` (intake verdicts by the hash of the raw bytes).
  - A warm `check` reads one stat file and one facts pack and opens no body. The preview opens bodies on demand.
- **Invalidation and safety.**
  - Entries are immutable and written atomically (temporary file, then rename), so two runs can share a cache. A rename refused on Windows because a file is open is retried, then skipped.
  - An entry that does not read is a miss and is deleted.
  - A cache failure never fails a check: it prints one note and continues uncached.
  - Versions unused for 30 days, and the oldest versions once the cache passes 1 GB, are removed at the end of a run.
- **In CI** the cache is restored with `actions/cache`, keyed by the tool version, so a pull request re-renders only what it changed.

**Budgets.** The reference machine is GitHub's `ubuntu-latest` hosted runner (4 vCPU, 16 GB), the default pool, and a production bundle. Two generated corpora are committed as generators with fixed seeds, built from `packages/markdown/corpus` (headings, lists, tables, code in several languages, every built-in block, links, images):

- **L**, shaped like lockstay's docs: 486 Markdown files with lockstay's size distribution (median 14 KB, 95th percentile 150 KB, largest 870 KB, 18 MB in all), 90 assets, 12 collections in nested folders, about 4,000 relative links, and planted problems of every kind.
- **XL**: 5,000 Markdown files (median 6 KB, 95th percentile 30 KB, largest 400 KB, 40 MB in all), 500 assets and 40 collections, with the same planted problems.

| Measure | L | XL |
| --- | --- | --- |
| `quill --version` | 150 ms | 150 ms |
| `check`, cold (empty cache) | 25 s | 60 s |
| `check`, warm, nothing changed | 1.0 s | 2.5 s |
| `check`, warm, one page (under 50 KB, linked from 20 pages) changed | 2.0 s | 3.5 s |
| `check`, warm, one page added that 20 pages link to | 3.0 s | 4.5 s |
| `preview`, start to listening | 0.6 s | 1.5 s |
| `preview`, first page under 50 KB served, cold cache | 2.5 s | 4.0 s |
| `preview`, first page served, warm cache | 0.8 s | 2.0 s |
| `preview`, save to reload event, page under 50 KB | median 250 ms, 95th percentile 500 ms | same |
| `preview`, save to reload event, any page | its render time plus 250 ms | same |
| `preview`, an already rendered page, server time | 50 ms | 50 ms |

The cold `check` figures come from today's parser throughput (about 1 MB a second per thread): L is about 30 to 60 CPU-seconds on the runner, spread over three workers. They are ceilings for the first delivery and only move down. The parser is the same code the server publishes through, so making it faster helps both.

**Memory ceilings:**

| Measure | L | XL |
| --- | --- | --- |
| `check`, main thread resident | 350 MB | 600 MB |
| Each render worker's heap | 512 MB, a hard cap (`resourceLimits.maxOldGenerationSizeMb`) | same |
| `check`, peak resident, all threads | 1.5 GB | 1.5 GB |
| `preview`, steady state, workers retired after 30 s idle | 400 MB | 800 MB |

**How they are enforced:**

- **The corpus benchmark.** `pnpm --filter @quill/cli bench:budgets` (`apps/cli/bench/budgets.ts`) runs every row above against the production bundle and exits non-zero when one is over. It takes the median of three runs for times, and the peak sampled `rss` and worker heap for memory. It prints a table like `check:bundle`'s.
- **The CI job.** The L and XL corpora take about two minutes, so they do not run inside `pnpm check`. A CI job of its own, `cli-budgets` on `ubuntu-latest`, runs the benchmark on every push to `main`, and on pull requests that touch:
  - `apps/cli`, `packages/format`, `packages/site`, `packages/markdown` or `packages/highlight`;
  - `packages/application/src/use-cases/source-*`, `sync-source.ts` or `render-document.ts`.

  That is ADR-033's "budgets checked in CI on hot-path changes".
- **The quick guard.** Inside `pnpm check`, `apps/cli/src/check.budget.test.ts` runs as part of the existing `pnpm test:budgets`, on a 40-file corpus. It holds the same paths to proportional budgets in seconds, and counts work that must not happen, as the editor's budget tests do: no worker started and no file read on a warm run with nothing changed, and exactly the expected bodies re-rendered after one edit.
- **Phase timings.** `--timings` prints a breakdown to standard error (list, hash, plan, render, report) so a regression can be found without a profiler.
- **Package size.** It is enforced by `check-cli-package.ts` in `pnpm check` (section 3).

### 5. Stability

**Deterministic output.**

- Problems are sorted by path, then line, then column, then code, then message, by code point. Nothing is sorted with `localeCompare`, which changes with the locale.
- Paths are POSIX and relative to the repository root, on every operating system. A path given on the command line with `\` is normalised. Unicode in names is never normalised, because Git and the server do not normalise it.
- A report holds no timestamps, durations, absolute paths, host names or user names.
- Output is UTF-8 with `\n` line endings on every system. Colour is used only on a terminal, never when `NO_COLOR` is set, and never in JSON.
- CRLF and LF give the same report and the same bodies. This is an obligation on the shared pipeline, tested by a fixture checked out both ways. If the pipeline does not meet it today, fixing it is part of delivery, and the server gains the same fix for repositories committed with CRLF.
- The parity fixtures' JSON is compared byte for byte with the same golden file on Linux, macOS and Windows.

**Exit codes and output.**

- **Exit codes.**
  - `0`: nothing at or above `--fail-on`.
  - `1`: a problem at or above `--fail-on`. The default is `warning`, so a broken link fails a pull request; `--fail-on error` relaxes it.
  - `2`: a usage or configuration error: an unknown flag, an ambiguous or missing manifest entry given on the command line, `--rev` without `git`, `--collection` beside a manifest.
  - `3`: the tool failed: a crash, a worker that failed twice on one file, an I/O error.

  A bad manifest is a content problem, so it exits `1`.
- **`--format text`** (the default) prints `path:line:column: severity code: message`, which editors' problem matchers and lockstay's `path:line: message` habit read, and a summary line.
- **`--format json`** prints one document, versioned as `quill-check/1`. Its JSON Schema ships in the package and is tested against every fixture. It holds:
  - `schema`;
  - `tool` (version, `RENDER_VERSION`, the registry signature's hash);
  - `target` (manifest path, entry, mode, `fileSet`);
  - `limits`;
  - `assumptions`;
  - `summary` (counts by severity, documents, assets);
  - `problems` (`code`, `severity`, `path`, `line`, `column`, `message`, `data`);
  - `tree`.

  Within version 1, changes are additive (ADR-033). A breaking change is `quill-check/2`, and `--schema 1` keeps the old one for at least two minor versions.
- **`--format github`** prints GitHub Actions workflow commands (`::error file=…,line=…,col=…,title=<code>::<message>`, escaped as GitHub requires) and then the text summary, so problems beyond GitHub's per-step annotation limit are still in the log.

**Content edge cases.**

- **A bad manifest.** `check` reports `manifest-invalid` with the line, and nothing else, because the sync would place nothing. `preview` keeps serving the last good plan with a banner naming the problem, as a failed sync keeps the last good tree.
- **A huge file.** The per-file cap is the server's (16 MiB today, moved from `git-cli-external-source.ts` to a shared constant). A file is read up to the cap plus one byte and refused as `file-too-large` beyond it. Below the cap, a render that runs past 30 seconds, or a worker that exceeds its heap, is retried once in a fresh worker. A second failure is an exit `3` naming the file, never a content problem the server would not report.
- **Symbolic links** are never followed (ADR-061). The tree walk uses `lstat`. A symbolic link, or a Windows junction, under a collection's path is one refused `file-symbolic-link`, and is not descended into.
- **Files outside the manifest's paths.** Their contents are never read. Their names are read only to answer whether a link's target exists, as on the server.

**The watcher.**

- `fs.watch` is recursive on each cone root and on the manifest's directory, and nowhere else. It does not watch `node_modules`, `.git` or the cache.
- **An event is a hint.** It names a path to stat again; its type is ignored, because editors save in different ways: a write in place, a temporary file renamed over the target, or a delete and a create.
- **Debounce.** A batch is taken after 75 ms without events, and at most 500 ms after its first event. A `git checkout` of a thousand files is one batch.
- **A path missing when it is stat'ed** is checked again after 50 ms before it counts as deleted, so an atomic save is a modification. A read that fails with `EBUSY` or `EPERM` (an editor or a virus scanner holding the file on Windows) is retried three times inside that window.
- **A watcher error or an overflow** (`EMFILE`, `ENOSPC`, a dropped Windows buffer) triggers a full rescan through the stat index, which is cheap. If a watcher cannot be created, the cone is polled every second and one line says so.
- **A changed manifest** re-plans everything.

**The preview's boundaries.**

- **Local by default.** It binds to `127.0.0.1` on port 4310, or the next free port among the following ten. `--port` makes the port strict. `--host <address>` is needed to listen elsewhere, and prints that anyone who can reach the address can read the documents.
- **Host header.** A request whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or the `--host` value is refused, so a DNS-rebinding page cannot read the preview.
- **Only what the plan holds.** It serves:
  - each planned document at its repository path, and each generated folder document at its folder's path;
  - the assets the plan imported, at the `/api/attachments/<id>` addresses the bodies already carry;
  - the site's stylesheet, scripts and fonts under `/s/_assets/`;
  - `/_preview/events` (server-sent events) and `/_preview/problems`.

  Every other request is `404`, including every other file in the repository. A request is looked up in the plan's maps and is never joined onto a disk path.
- **Headers.** It sends the public site's content security policy, plus `connect-src 'self'` for the event stream, and `Cross-Origin-Resource-Policy: same-origin`. It sends no CORS headers.
- **Reloading.** The one script the preview adds is addressed by its hash, like the reader script. It reloads a page when an event names its path, and keeps the scroll position.
- **Links.** A body's canonical `/d/<id>` links are rewritten to preview addresses by the same per-request rewrite the public site uses. Links outside the cone go to the forge at `HEAD`, or are shown as their words without `git` or with `--outside-links text`, as the source setting does.
- **Rendering order.** The first request renders its own page first. The rest are then rendered in the background on one worker, so later pages open from the cache and `/_preview/problems` fills in.

**No network during `check`.**

- `check` opens no connection. Every `git` command runs with `GIT_NO_LAZY_FETCH=1` and `protocol.allow=never`.
- A test runs the tool with `net`, `dns`, `http`, `https` and `fetch` replaced by functions that throw, and the check must still pass.
- Link previews (ADR-042) render as their link, as the body's slot does before a card is fetched. A future `--allow-network=link-previews` would fetch cards through the server's SSRF-safe client, once that client is in a shared package. It is not part of the first delivery.
- `preview` listens but makes no outbound request.

### 6. Configuration

- **The manifest.** The tool reads the manifest the server reads: `.quill/workspace.yaml`, or `--manifest <path>` for a source configured with another path (lockstay keeps `docs/quill.yaml`).
- **Choosing an entry.** A manifest with one workspace needs no choice. For a manifest with several:
  - `--workspace <slug>` reads one;
  - `--all` checks every entry and reports by entry;
  - with neither, the tool exits `2` and lists the entries.
- **No manifest.** A repository with no manifest can be checked with `--collection <slug>=<path>`, repeated. These are exactly a source's settings collections, which the server falls back to when the head has no manifest (`layoutFromSettings`). `--collection` beside a manifest is exit `2`, because the server would read the manifest and ignore the settings.
- **Link settings.** `--outside-links forge|text` (default `forge`) and `--forge-view-template <template>` mirror the source's link settings. Without a template, the forge is inferred from the origin URL as the server does (`defaultForgeViewTemplate`).
- **No configuration file of the tool's own.** Everything the server reads is in the manifest; the rest are flags in the repository's script.

**Which Quill version a repository targets.**

- **The manifest gains one top-level key, `requires`, a semver range** (`requires: ">=1.4 <2"`). This amends ADR-061's manifest by one known key. A server older than this change reports it as an unknown key, which is harmless.
- **The tool** reports `version-drift` when its own version is outside the range. The message names the command that runs a matching version (`npx @quill/cli@1.4 check`).
- **The server's source admin page** says when its own version is outside the range. Drift is then visible from both sides, with no network.
- **The registry.** The report prints the tool's registry signature. When run-time block installation lands (ADR-060 step 7), the admin page shows the instance's signature beside it, and the tool gains `--blocks <dir>` to load the same `.qblock` archives. Until then both registries are Quill's built-in blocks for the version, so they are equal by construction.

### 7. What lockstay keeps

Lockstay's `docs:check` checks heading anchors, front matter fields and raw HTML, which Quill's sync does not report today. Lockstay keeps those checks until each is added to the shared code (section 1's rule). It can drop `apps/docs` and its block allowlist once `quill preview` and `quill check` pass on its docs.

## Alternatives considered

- **Running the full server locally in Docker.** It is exact, but rejected:
  - It needs Docker, Postgres and minutes to start.
  - It reads a repository only through a sync of committed history, so the working tree is never what is shown.
  - It brings accounts and setup into an author's loop.
  - A per-PR CI check would stand up a database to report what one function computes.
- **A separate lightweight renderer** (`marked` or `markdown-it`, which are faster). Rejected because it would drift. Lockstay has one (`apps/docs`), and drift from it is why ADR-060 had to reach parity before Quill could serve those pages. The parser's cost is better paid once, in code both sides share, and cut with a cache and a pool.
- **A browser-only preview** (the pipeline bundled for the browser, reading files through the File System Access API). Rejected:
  - That API exists only in Chromium, and watching a folder is not dependable there.
  - It gives nothing to run in CI, so `check` would need a second runtime anyway.
  - It would load the whole pipeline into a tab for a repository of thousands of files.
- **Making Quill a framework that repositories build with** (a Docusaurus-style build with its own configuration and plugins). Rejected: it makes Quill a build dependency of the documents, which is what the owner ruled out. Here the documents stay plain Markdown read by a server, and the tool is a development dependency whose removal changes nothing.
- **Running the sync's write path in the tool, against an in-memory content store.** It reuses the most code, and the parity suite does run it this way on the server side. Rejected for the tool itself:
  - It replays into a store that is thrown away at exit, so a warm run would need that store persisted.
  - Its writes (stamping ids, serialising stored copies, building trees) change nothing in the report.
  - Once the sync takes the plan's decisions, the write path decides nothing the tool needs.
- **An instance-side check of pull-request branches** (a GitHub App that runs the instance's own sync on a branch). Rejected as the inner loop: it needs the instance reachable from CI, and it sends unmerged content to an instance. It may be worth having later, as previewing a branch inside Quill.

## Consequences

- **Authors get the loop.** A page can be seen before it is pushed, and a pull request fails on what the sync would report, with a line to fix.
- **The tool and the server cannot disagree without a test failing.** That costs the parity suite (about a minute of CI on three operating systems) and a rule: changes to the sync's reporting or to rendering keep it green.
- **Code moves, with no change in behaviour.**
  - `@quill/format` and `@quill/site` are new packages, taken out of `apps/server`.
  - The sync job is reorganised around `planSourceHead`.
  - Two `ExternalSource` adapters join `packages/content-store`.
- **The tool ships with every release.** It is published from the same tag, so the release process gains an npm publish, and the tool's version is a compatibility promise (ADR-033).
- **The manifest gains `requires`,** and the source's admin page gains a drift line.
- **Offline limits stay listed.** The organisation's theme, custom emoji and labels, run-time blocks, an instance's own size caps and titles of native documents are not known offline. The report's `assumptions` say so.
- **Cold runs are bound by the parser,** at about 1 MB a second per thread today, on the server too. The budgets are set from it and ratchet down as it improves.
- **Revisit** if the parser's throughput changes the cold budgets by a factor of two, if run-time blocks land (step 7), or if a need for network checks appears beyond link previews.

## Delivery

A milestone of its own, **M3b — Check and preview in the repository**, after M3a, whose sync it shares. Each step ships on its own:

1. This ADR.
2. **The plan.** `planSourceHead` and `SourceReport` in `@quill/application`. The sync job and the settings preview take the plan's decisions. The parity suite's server half lands with golden reports.
3. **The packages.** `@quill/format` and `@quill/site` are moved out of `apps/server`, with the dependency rules.
4. **The adapters.** `WorkingTreeSource` and `LocalRevisionSource` in `packages/content-store`.
5. **`quill check`.** The three formats, exit codes, the cache, the pool, the budget tests and the `cli-budgets` CI job, and the parity suite's tool half on Linux, macOS and Windows.
6. **`quill preview`.** The server, the watcher, reloading, and its budgets.
7. **Packaging and release.** The bundle, `check-cli-package.ts`, publishing from the release tag, and an author's guide to the tool next to `docs/extending/`.
8. **Drift.** `requires` in the manifest, and the drift line on the source's admin page.

It is done when:

- lockstay's CI runs `quill check` on every pull request;
- for the same commit, its report equals what lockstay's instance lists on the source's admin page;
- every budget above is green on the reference runner;
- the parity suite is green on all three operating systems.
