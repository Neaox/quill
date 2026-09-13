# External Git repositories as read-only document sources

- **Status:** proposed
- **Recorded:** 2026-09-12
- **Trigger:** a team asks to index documentation that lives next to their code without moving it, or remote sync (`quill-plan.md` §9.6) is scheduled, since this is its read half and should be designed with it.

## Idea

A workspace can attach an external Git repository (a product's own repository
with a `docs/` folder, a shared runbook repository) as a source of documents.
Those documents render, search, link, and take comments like any other, but
they are read-only inside the product: the edit affordance takes the reader to
the file at the repository head in the hosting service (GitHub, GitLab, Azure
DevOps), where the change goes through that repository's own review. History
is still browsable here, because the store already keeps revisions.

## Who it serves

An organisation gets one central, searchable index of every application's
documentation, while each application keeps owning its own docs in its own
repository, where they change in the same pull request as the code and so stay
current. Neither side gives anything up: the platform is the place to find and
read, the repository stays the place to write.

## What it touches

- A `source` concept on a collection: `native` (default) or `external` with the
  remote, branch, path prefix, and the URL template for "edit at head".
- The content store already models revisions by an "external" author (§9.6);
  attached repositories reuse that, one bare repository per source, so the
  mirror is a normal content-store workspace with writes disabled above the
  port. No registered decision needs reopening.
- Permissions: an attached source inherits the collection's grants; the edit
  capability is always off for its documents.
- Rendering: front matter is optional in external files, so document ids come
  from a stable mapping (path at attach time, tracked through renames by the
  Git history) rather than from the file.

## How it could work

Keeping the mirror fresh, in the reliable order: cheap check, background fetch,
atomic swap, then tell the reader.

1. **Check on read.** Opening an external document compares the mirror's head
   against the remote's advertised head (a single `ls-remote`, or the hosting
   service's API with an ETag, cached for a short window so a busy document
   does not hammer the remote).
2. **Fetch in the background.** When the remote is ahead, the outbox enqueues a
   sync job for the source. The page renders the current mirror immediately
   and shows a promise toast (`docs/design/feedback.md`): "Updating from the
   source repository" while the job runs.
3. **Swap atomically.** The job fetches into the mirror, records the new
   revisions through the normal publish path (so render caching, search
   indexing, and link indexing all fire as usual), and advances the head with
   the store's compare-and-swap.
4. **Prompt to reload.** The reader's page is subscribed to the document's
   envelope (polling first, server-sent events later, the same channel presence
   uses). When the head advances the toast resolves to "Updated" with one
   Reload action. Never reload underneath someone who is reading or selecting
   text.
5. **Webhooks first, a daily reconciliation behind them.** A hosting-service
   webhook (below) is the primary trigger: it keeps the mirror within seconds
   of the repository and, because a sync creates a document for every new
   file under the source's path prefix, new docs appear on their own without
   anyone attaching them. A scheduled reconciliation per source (daily by
   default, configurable) is the safety net for missed deliveries and for
   sources without webhook access, and the check-on-read in step 1 covers the
   gap between the two for whoever opens a document first. All three feed the
   same idempotent sync job.

### Hosting-service webhooks

Both major hosts notify on pushes at branch level; neither filters by path, so
path filtering happens on receipt.

- **GitHub**: the `push` event (repository or organisation scope, or a GitHub
  App subscribed to `push` with read access to contents) carries the ref, the
  before and after commit ids, and each commit's added, modified, and removed
  paths; the commit list is truncated at twenty, so large pushes use the
  compare API between the two ids. Deliveries are HMAC-signed with a shared
  secret and are not retried automatically.
- **Bitbucket Cloud**: the `repo:push` event carries old and new ref states and
  a truncated commit list but no paths; the diffstat API between the two
  commit ids supplies them. Deliveries can be signed and are retried a few
  times.
- **Bitbucket Data Center**: the `repo:refs_changed` event with from and to
  hashes and a change type per ref, signed with a secret.
- GitLab (push hook with per-commit file lists and a branch filter) and Azure
  DevOps (branch filter, no file list) fit the same shape.

Design consequence: the webhook is a hint, never the source of truth. The
handler verifies the signature, ignores other branches, dedupes on the
delivery id, and enqueues the same sync job the poller uses; the job fetches
and derives what changed from the repository itself, then applies the source's
path prefix. A missed or duplicated delivery is therefore harmless, and polling
remains the fallback.

## Open questions

- Whether comments anchored to external content survive an upstream rewrite
  the same way they survive a native edit (ADR-022 anchoring should apply
  unchanged, but this needs a test with a real repository history).
- Rate limits and credentials for private repositories: a per-source deploy
  key or token, stored envelope-encrypted per ADR-034, never in settings files.
- Large monorepositories: fetch with a path filter or sparse checkout rather
  than mirroring the whole history.
- Whether "read-only here, edit there" should later grow a "propose a change"
  path that opens a pull request from an edit made in the product. That is the
  write half of §9.6 and belongs there.
