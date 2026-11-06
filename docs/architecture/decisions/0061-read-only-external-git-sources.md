# ADR-061: Read-only external Git sources

**Status:** Accepted
**Date:** 2026-11-07
**Related:** quill-plan.md sections 9.4 to 9.6, 12 and 33; `docs/ideas/external-git-sources.md` (the idea this adopts); ADR-005 (front matter), ADR-011 (security baseline, outbound requests, uploads), ADR-012 (permissions), ADR-014 (content store, remote sync's wire choice), ADR-015 (publish semantics), ADR-022 (comment anchoring), ADR-031 (render caching), ADR-034 (secrets), ADR-035 (addresses), ADR-036 (drawings), ADR-044 (heading anchors), ADR-046 (dead links), ADR-047 (images), ADR-049 (tree order), ADR-055 (ownership), ADR-056 (outbox), ADR-058 (navigation blocks); decisions D5, D15, D16, D17

## Context

Many teams keep their documentation in the repository of the code it describes, so a page changes in the same pull request as the code and goes through the same review. They want the reading side Quill already has (one index across every application, search, comments, a public site) without moving where the docs are written.

Quill today owns its content: drafts in Postgres, published Markdown in its own Git-format store, one bare repository per workspace. Two-way sync with a remote is planned for M4 (§9.6) with no code yet, and its read half is the idea recorded in `docs/ideas/external-git-sources.md`. A team that runs one internal instance for staff and one internet-facing instance for public pages from the same private repository is a real case: the internet-facing instance must never hold a file it must never show, so fetching the whole repository and filtering afterwards is not acceptable.

Three facts of the code shape the answer:

- **The store finds a document by the `id` in its front matter** (`document-index.ts`, `document-front-matter.ts`). Repository docs rarely carry one, and Quill cannot write one back.
- **`isomorphic-git`, ADR-014's choice for remote sync, does not support partial clone or sparse checkout.** It can fetch a whole repository or nothing.
- **`manage` gates both structure and access.** Renaming, moving and deleting documents, and creating collections, ask for `manage`. So do share links and workspace settings. A read-only source must turn off the first set and keep the second.

## Decision

### A source is configured on a workspace

A workspace is either **native** (the default, as today) or **sourced**. A sourced workspace has one source:

- **Remote**: an `https` URL.
- **Branch**: the branch to read.
- **Manifest path**: `.quill/workspace.yaml` by default (the file §9.5 already places in a workspace), any path in the repository allowed.
- **Credentials**: a GitHub App installation (an installation token is minted for each fetch and never stored), or a deploy token for other hosts. Both are held as product secrets (ADR-034), referenced by name.
- **Forge**: `github`, `gitlab`, `bitbucket` or `generic`. The forge supplies the URL templates for "edit at head" and "view at commit", and the webhook format. `generic` takes both templates as settings and has no webhook.
- **Workspace entry**: which entry in the manifest this workspace reads, by slug, when the manifest describes more than one.
- **Commit messages**: `subject` (the default) shows each commit's first line as the revision's change note; `none` shows no message. An instance whose readers should not see the team's commit messages sets `none`.
- **Strict prefixes**: off by default; see "Fetching" below.

**The manifest decides the structure.** It names the workspace's collections, each by a slug, a title and a path (a directory, a file, or a glob), with an optional `order` rule. It can also list paths to exclude, asset paths, and redirects. One manifest may describe several workspaces, so two instances can read different entries of the same file.

```yaml
version: 1
workspaces:
  - slug: handbook
    collections:
      - { slug: guides, path: docs/guides, title: Guides }
      - { slug: decisions, path: docs/adr, title: Decisions, order: filename }
      - { slug: packages, path: 'packages/**/README.md', title: Packages }
    exclude: [docs/guides/drafts/**]
    assets: [docs/diagrams/**]
    redirects: { docs/guides/old-setup.md: docs/guides/setup.md }
```

A manifest with only top-level `collections` describes one workspace. Keys this version does not know are kept and reported on the source's admin page, so a later ADR can give them meaning and a team can keep its own keys in the same file. A collection keeps its identity by its slug: renaming its title renames it, and changing its slug retires the old collection and creates a new one.

### Read-only above the content-store port

**Nothing a person does writes a sourced workspace's content.** The sync job is its only writer. This is enforced twice:

- **The authorizer narrows capabilities by the workspace's origin.** A document in a sourced workspace has `edit` and `publish` off for everyone, instance administrators included. Creating, renaming, moving, deleting and restoring documents, and creating, renaming and deleting collections, are off too. These are gated by `manage` today, so they move to a new capability, **`arrange`**, which a role grants exactly where it grants `manage` today and which a sourced workspace turns off. `manage` keeps grants, share links, settings and the public site. `comment` and `view` are unchanged. The rule is a pure domain function of role and origin, so the resolver, the materialised permission table and the routes cannot disagree.
- **The content store refuses a write from above.** The composition root hands the application a store for a sourced workspace that refuses `publish` and `putFile` with a typed refusal. The sync job is composed with the store that writes. A route that forgets the capability check therefore still cannot write.

Drafts, locks, review requests and templates never exist for a sourced document. **The Edit action becomes a link** to the file at the branch head on the forge. It is offered to readers whose role would grant `edit` in a native workspace, and reads "Edit on GitHub" (or the forge's name). The document's envelope carries that address, and also the address of the commit the page was rendered from.

### Fetching: the `git` CLI, partial and sparse

The sync job fetches with the **`git` CLI**:

1. **Clone once.** `git clone --filter=blob:none --no-checkout --sparse` makes a partial clone into a per-source cache directory. Commits and trees arrive; no file contents do.
2. **Narrow to the manifest.** The manifest is read first, as one blob. Its collection, asset and manifest paths become the sparse-checkout cone (`git sparse-checkout set --cone`). A glob is widened to its longest literal directory for the cone and narrowed again by Quill when it reads. `packages/**/README.md` fetches the blobs under `packages/` and reads only the READMEs. A source with **strict prefixes** refuses globs, so the cone is exactly the paths the manifest names.
3. **Fetch only the cone's blobs.** `git backfill --sparse` fetches the blobs that history needs, in batches, for paths inside the cone. When only the head is wanted, a sparse checkout fetches the head's blobs alone.
4. **Never fetch anything else.** Every later command runs with `GIT_NO_LAZY_FETCH=1`. A command that would need a blob outside the cone fails instead of fetching it, and that failure is a defect, never a fallback.

**No blob outside the cone ever reaches the instance.** Commits, trees, author names, commit messages and the names of every path in the repository do. That is the price of a partial clone, and the source's admin page says so. Path names and commit messages outside the cone are read only to compute the cone's changes; they are never stored, indexed or shown. A team whose internet-facing instance must not hold even file names from the rest of the repository should give it a repository of its own.

**The CLI is run hardened.** Arguments are passed as an array with no shell. The CLI runs with:

- **Protocols:** `-c protocol.allow=never -c protocol.https.allow=always`.
- **No inherited configuration:** `GIT_CONFIG_NOSYSTEM=1`, a global configuration of `/dev/null`, and an empty `HOME`.
- **No prompts or hooks:** `GIT_TERMINAL_PROMPT=0` and an empty `core.hooksPath`.
- **No submodules, no LFS:** submodules are never fetched. `GIT_LFS_SKIP_SMUDGE=1` is set, so an LFS file arrives as its pointer, and the pointer is reported as an unsupported file.
- **Limits:** a timeout and an output cap on every command.

Before each fetch, the remote's host is checked against the outbound policy of ADR-011: resolved, and refused in private and link-local ranges unless the instance allowlists that host (a self-hosted Git server is a real case). Redirects are refused (`http.followRedirects=false`). The CLI resolves the name again itself, so this check cannot rule out DNS rebinding. An instance that needs that guarantee sets an egress proxy that enforces the same policy (`http.proxy`). Files are read as blobs by object id (`git cat-file --batch`), never from a working tree, so a symbolic link in the repository is a file with a path in it, not a way out of the cache directory. The cache directory is disposable: deleting it costs one clone. The content store remains the record. On the database backend, which has no volume, the clone lives in the job's temporary directory.

**How this coexists with ADR-014.** ADR-014 keeps the wire protocol out of Quill's code and chose `isomorphic-git` to push and pull Quill's *own* materialised repository, because it needs no binary. A source is not Quill's repository: it is an input the sync job reads and replays through the ordinary publish path. It needs partial clone and sparse checkout, which `isomorphic-git` does not have. So:

- The `git` CLI, 2.49 or later (for `git backfill`), becomes a runtime dependency of the process that runs the sync job, and the container image ships it.
- ADR-014's store engine, its `ObjectStore` port and its own-repository rules are unchanged. The wire protocol is still never implemented in Quill code.
- M4's two-way sync builds on this mechanism for its pull half. Once the CLI is a runtime dependency, the reason ADR-014 gave for `isomorphic-git` ("no binary required") no longer applies, so M4's ADR decides whether push uses the CLI too.
- The fetcher lives in `packages/content-store`, behind its internal entry point, so rule 9 of `AGENTS.md` holds as written. Above the port, the application sees an **`ExternalSource` port** whose vocabulary is source revisions (opaque ids with an author and a time), the files at a revision, and the changes between two revisions (added, modified, removed, renamed, by path). It never sees commits, trees or refs.

### Identity without front matter

- **An id is minted at first sight.** The first time the sync job sees a document file, it mints a UUID and records `(source, path) → document id` in a **path map** in Postgres.
- **The stored copy carries the id.** Quill's stored copy of the file carries that id in its front matter, written by the sync job, so the store finds it exactly as it finds a native document. D17 therefore holds inside Quill: identity is a UUID in the stored front matter. The repository's file never needs one and is never changed.
- **A file's own `id` field is ignored.** It is replaced in the stored copy, so a copied file can never claim another document's identity.
- **Renames follow Git's rename detection.** The change list between two revisions is computed with `git diff --find-renames`, limited to the cone. A rename is a `move` change: the path map entry moves, and the document keeps its id, address (ADR-035), history and comments. A file that moves into the cone from outside it is an addition, because finding the rename would need a blob from outside.
- **The manifest's `redirects` cover what detection misses.** A split, a merge, or a rename with heavy edits is declared there, old path to new path.
- **A deleted file is archived, never a 404.** It gets an ADR-046 tombstone and answers `410` with the page's title and the commit that removed it, under ADR-046's access rules. When the manifest redirects its path, it answers `301` to the replacement for readers who may open it. It is not put in the Trash and is not purged on the restore window, because restoring it is the repository's decision. If a file appears again at a path whose document was archived, the same id comes back and the tombstone is removed.
- **A file that leaves the source becomes archived the same way.** That includes a file newly excluded or a collection removed from the manifest.

### Tree, titles and order

- **Folders become documents.** A folder's `index.md`, or else its `README.md`, becomes the folder's document, parent of the folder's other documents. A folder with neither gets a generated document whose body is a child-pages block (ADR-058). The folder's id is minted for its path, so when the folder gains a README the generated document is replaced in place and keeps its id and address.
- **Titles** come from front matter `title`, then the first H1 (ADR-015), then the file or folder name, humanised.
- **Order** comes from front matter `order` (ADR-049's sort key), then the collection's `order` rule in the manifest: `title` (the default), `filename`, `newest` or `oldest` (by first commit). Documents with an `order` come first. The sync job projects the rest onto sort keys above them, so ADR-049's tree, paging and public site need no new mode.
- **Other front matter is read as in a native document** (ADR-005, ADR-059): tags, status and owners when present, and unknown fields kept. Ownership (ADR-055) is unset by default; an owner named in front matter is shown as written, and linked to a person only by a verified address.

### History

- **One revision per first-parent commit.** Each commit on the branch's first-parent line that changes the source becomes one publish of all its changes to the cone.
- **Authorship is the commit's.** The revision is authored as the commit's author (name and address), timestamped with the commit's committer date (when it reached the branch), and carries a `Quill-Source-Commit` trailer with the commit id. "Changed by" is therefore true.
- **Merge-commit workflows credit the merger.** In squash-merge and rebase-merge workflows the first-parent commit's author is the change's author. In merge-commit workflows it is whoever merged, and that is a known limitation.
- **Authors are names, not accounts.** An author is shown as the commit's name. It is linked to a Quill person only when the address is one that person has verified, and it never creates an account.
- **The first sync replays the source's history** back to the source's history setting: `full` (the default), from a date, or `head` (one revision, "Imported at `<commit>`").
- **Replay is resumable.** A commit whose trailer is already in the revisions index is skipped, so an interrupted first sync picks up where it stopped.
- **The port gains two optional fields.** `PublishRequest` gets `authoredAt` and `sourceRevision`. Only the sync job's composition sets them, and the revisions index records the source revision so a page can show the commit it was rendered from.

### Freshness: one idempotent sync job, three triggers

All three triggers write the same `SourceSyncRequested` outbox event (ADR-056). Its consumer is the one sync job.

- **Push webhook** (primary). It is verified by its signature (GitHub's `X-Hub-Signature-256` HMAC over the raw body with the source's webhook secret; each forge's equivalent) before anything else is read. It ignores other branches, and is deduplicated on the delivery id (`X-GitHub-Delivery`) in a table kept for a week. It answers `202` without fetching. The payload is a hint: the job derives what changed from the repository, so a missed or repeated delivery cannot change what is stored, and neither can anything a payload says.
- **Daily reconciliation** (safety net). It runs per source, for missed deliveries and for forges or installations without webhooks. The interval is configurable.
- **Check on read.** Opening a sourced document asks whether the source's last remote check is older than a minute. If so, it compares the remote head with `git ls-remote` off the request path, and requests a sync when the remote is ahead. The page renders immediately from what is stored. When the sync lands, it offers a reload as the idea describes (a promise toast, never a reload under the reader).

**The job is idempotent and single-flight.**

- **One job per source at a time.** It takes a lock keyed by the source and reads the remote head.
- **It does nothing when there is nothing new.** If the head equals the last synced commit, the job ends.
- **Otherwise it replays.** It fetches, then replays first-parent commits from the last synced commit to the head, each as one publish with a compare-and-swap.
- **A rewritten branch gets one revision.** If the last synced commit is no longer an ancestor of the head (a force-push), the job publishes the difference between the stored tree and the head as one revision ("The source's history was rewritten") and never rewrites Quill's own history.
- **A changed manifest re-plans the whole tree.** Collections are created, retitled or retired by slug. Documents are placed, moved or archived, all in the revision of the commit that changed the manifest.

**A failed sync never empties a workspace.** Each replayed commit is a complete, consistent state, so a failure part-way leaves the workspace at the last commit that synced. The source records what failed and at which commit: an invalid manifest (with the line), a fetch or credential failure, a file refused, or a command that hit its limit. The source's admin page shows it, with the last good commit and the time of the last attempt. The workspace's administrators are notified once per distinct failure, not once per attempt. Readers see the commit the page was rendered from, never an error.

### Relative links, resolved at render (Q2)

- **Relative links resolve at render time.** A link such as `../adr/0012-auth.md#token-rotation` resolves against the document's path and the path map *of the revision being rendered*, to the document's canonical address (`/d/<uuid>`) and its heading anchor. Anchors already use GitHub's slug algorithm (ADR-044), so anchors written against the forge resolve here too. The resolved targets are part of the render input, so ADR-031's cache key covers them and the cached body stays the same for every reader. Links are also recorded in the link index at sync, so backlinks and broken-link reports work.
- **A link to a page the reader may not see renders as plain text.** The per-request link rewrite the public site and share pages already apply (`surface-links.ts`, `rewrite-links.ts`) is applied on the signed-in reader for sourced documents too. A reader who cannot view the target gets the link's words with no address, so no page leaks another page's title or address.
- **Links to repository files outside the source** (outside the cone, excluded, or not a document) go to the forge at the synced commit, not at the head, so the link shows the file as it was when the page was synced. A source can set this to `text` instead, for readers who cannot open the repository; the default is `forge`.
- **Broken links are listed per commit** on the source's admin page: a relative link to a path that is not in the repository at that commit.

### Repository assets, as content-addressed attachments (Q3)

- **What is imported.** Files under the manifest's `assets` paths, and image files inside a collection's paths that a document references, are imported as attachments.
- **They go through the same pipeline as an upload.** That is content sniffing against the allowlist, the size cap, and metadata stripped before the hash is taken (ADR-011, ADR-047). An attachment is addressed by that hash and deduplicated per workspace, so an unchanged image is never imported twice.
- **Relative image paths resolve like links.** `../diagrams/flow.svg` resolves to the attachment.
- **SVG is drawn through ADR-036's drawing allowlist,** like any SVG attachment. A drawing's own `<style>` element is removed by that allowlist, so a repository's diagrams that depend on their own stylesheet lose it. The admin page reports each one, and the remedy is ADR-036's class vocabulary.
- **Refused files are listed and render as alt text.** A file refused for its type or size is listed on the admin page with the reason, and the image renders as its alternative text.
- **Assets belong to the source, not to a document.** An imported asset is kept while any stored revision references it, and collected after that. The `attachments` table therefore needs a source-owned row (no owning document) beside today's document-owned one.

## Alternatives considered

- **`isomorphic-git` with a full clone.** No new binary, and it matches ADR-014's wire choice. Rejected:
  - It cannot do a partial clone or a sparse checkout, so every blob in the repository would reach every instance, including an internet-facing one that must never hold internal files.
  - A large repository's unrelated history (prototypes, generated files, binaries) would be fetched and kept for nothing.
- **Writing in Quill and syncing back.** That is M4's two-way sync. Rejected as the way to serve docs that live next to code:
  - Docs written in Quill change outside the code's pull request and drift from it.
  - Two-way sync is the largest unbuilt piece of the plan and the place ADR-014 expects rewrites to hide.
  - Read-only is a strict subset that M4 can extend.
- **Requiring a front-matter `id` in the repository's files.** Rejected:
  - Quill cannot write it back to a read-only source.
  - Asking every author to paste a UUID into every file is a step people forget.
  - A copied file would carry another document's identity.
  - Git's rename detection plus a path map gives the same stability without touching the files.
- **Mirroring the remote's commits into the content store as they are.** Rejected:
  - The remote's trees reference blobs the instance must not hold.
  - Its files carry no ids, so the store could not find its documents.
  - Its layout is not §9.5's.
  - Replaying through the ordinary publish path gives render caching, search indexing and the link index for free.
- **Server-side sparse filters** (`--filter=sparse:oid=…`). Rejected: they would keep even trees outside the source off the instance, but the major forges do not support them.
- **Resolving relative links at sync time,** rewriting them into canonical links in the stored copy. Rejected:
  - The stored text would differ from the repository's in its body, not just its front matter, so a compare would show changes nobody made.
  - Per-reader visibility has to be decided at render anyway.
- **One instance with grants instead of two instances.** That is for each team to decide. This ADR makes both possible: an instance holds exactly the prefixes its manifest entry names.

## Consequences

- **Teams keep writing where the code is.** Quill becomes the place their docs are found, read, searched and discussed, with history and authorship that are true.
- **The `git` CLI (2.49 or later) is a runtime dependency of the sync worker.** The container image (M4) ships it, and the operations guide says which version.
- **Changes the code needs**, beyond the sync job itself:
  - **Capabilities.** The new `arrange` capability, and the routes that use `manage` for structure moved to it (`documents.ts` rename, move and delete; `collections.ts`; `workspaces.ts`). The domain rule narrowing capabilities by workspace origin.
  - **Content store.** A refusing store for sourced workspaces from the composition root, and `authoredAt` and `sourceRevision` on `PublishRequest`.
  - **Postgres.** The path map. Sources and their status. Webhook delivery ids. Source-owned attachments. A source revision column on the revisions index.
  - **Rendering.** The `ExternalSource` port and its adapter in `packages/content-store`. Relative-link and relative-image resolution in the render input. The link rewrite on the signed-in reader for sourced documents.
  - **Interface.** The Edit link and the "rendered from" commit in the envelope. The source's admin page.
- **The signed-in reader does not reduce links to unseen pages for native documents today.** This ADR does it for sourced documents only. Doing it everywhere is right and is a separate change.
- **Path names and commit messages from the rest of the repository reach the instance, but blobs do not.** Teams that need more separation use separate repositories.
- **Repository diagrams lose their own stylesheets** under ADR-036's allowlist until they use its class vocabulary.
- **Comments on sourced documents re-anchor across upstream edits** exactly as across native ones (ADR-022). A test against a real repository history is part of done.
- **Revisit** if `isomorphic-git` gains partial clone and sparse checkout, if forges support server-side sparse filters, or when M4's two-way sync is designed: its pull half is this ADR's job, and its push half adds conflict handling for a workspace that is no longer read-only.

## Delivery

A milestone of its own, **M3a — Read from a repository**, placed after M3 and before M4's two-way sync, whose read half it becomes (`quill-plan.md` §33). It is done when:

- every Markdown file under a source's paths renders, with its relative links and images resolved and zero broken links reported for a repository that has none;
- a push to the branch shows in Quill within a minute, and with the webhook turned off it shows after the daily reconciliation;
- renaming a file keeps its address, its history and its comments;
- deleting a file answers `410`, or `301` where the manifest redirects it;
- an instance reading only public paths of a repository holds no blob from outside them, proved by listing the clone's objects in an end-to-end test.
