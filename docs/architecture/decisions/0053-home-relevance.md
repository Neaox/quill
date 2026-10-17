# ADR-053: What is relevant to the person on the signed-in home

**Status:** Accepted
**Date:** 2026-10-13
**Related:** ADR-012 (permissions), ADR-033 (compatibility), ADR-034 (per-person data), ADR-052 (review requests), ADR-045 (access requests), docs/design/home.md

## Context

The home answers "where was I, and what changed since?" (`docs/design/home.md`). It currently orders by **global recency** of what the person may see. That is right for a small team and wrong at scale: an administrator can see every workspace in an organisation of hundreds, so the newest documents anywhere are noise, and "Continue writing" lists everybody's unfinished drafts, not theirs.

What the system records today cannot answer "mine" or "mine lately": documents carry no creator or last editor, `revisions_index` records an author's name and email but not their id, draft authorship is per block and cleared at publish, and nothing records what a person opened. Pins and recents are promised by the design document and not built.

## Decision

### Principle

Order by **how much it concerns this person**, then by recency within that. Concern, strongest first: **waiting on them**, **theirs**, **what they were just in**, **where they work**, **everything else they may see**.

### Sections, in order

1. **Needs your attention.** Review requests addressed to them or a group they are in (ADR-052), changes requested on their drafts, access requests they can decide (ADR-045), later mentions and replies. Omitted when empty. Each item says what is asked of them.
2. **Continue writing.** Documents with unpublished work **they started or last changed**, most recently touched by them first; drafts under review are marked.
3. **Jump back in.** Documents they opened recently, newest first.
4. **What changed.** Published changes, grouped by day, **in their places** by default: workspaces they have written in or opened in the last 90 days, plus pinned ones, and never their own edits. People who can see many workspaces get a quiet switch to **Everywhere**; the first visit with no history shows everywhere.
5. **Workspaces.** Pinned first, then by their own engagement (opens and edits, recency-weighted), then the rest by unit. Organisation-wide activity is only a tiebreaker.

### Data it needs, all expand-only (ADR-033)

- `documents.created_by` (nullable for existing rows) and `revisions_index.author_user_id` (nullable), so "mine" is an id and not an email match. Existing rows are matched by email once, by a backfill that skips ambiguity.
- `document_views (user_id, document_id, workspace_id, last_viewed_at, views)`, upserted when a person reads a document, keyed and indexed by user, kept 90 days. It is **the person's own record**: never aggregated across people, never shown to anyone else, not visible to administrators, clearable from preferences. The "What others are reading" idea stays gated on its own privacy decision.
- Pins in `person_preferences` (additive field, ADR-034).
- Review and notification rows from ADR-052.

### Cost

Every section is a bounded query by `user_id` or by the set of the person's places; the summary stays one request and the page stays independent of organisation size.

## Alternatives considered

- **Keep global recency, add a filter.** Rejected: the default is the experience.
- **Rank with a learned model.** Rejected: unexplainable, and nothing to learn from yet. Explicit signals first.
- **Track views in the content store or logs.** Rejected: per-person data belongs in Postgres (ADR-034).

## Consequences

- The home becomes personal and different for every person, which is the point, and each section can say why it is there.
- A new person sees an honest cold start, not a guess.
- Reading a document now writes a row: debounced, and off the request path.

## API contract (first build)

**Authorship.** `documents.created_by` (set when a document is created) and `documents.updated_by` (set on publish, restore, rename and move) are nullable user ids; `revisions_index.author_user_id` is the publisher's id, nullable. Existing rows stay null and are never guessed. A backfill is not run.

**Views.** `document_views (user_id, document_id, workspace_id, last_viewed_at, views)`, primary key `(user_id, document_id)`, index on `(user_id, last_viewed_at desc)`. Rows older than 90 days are deleted by the existing job runner. They are read only through the owner's own routes below; nothing aggregates them across people.

| Route | Does |
| --- | --- |
| `POST /api/documents/:id/view` | needs `view`. Upserts the caller's row; if the row was touched in the last 5 minutes it does nothing. `204`. Not audited |
| `DELETE /api/me/history` | deletes all of the caller's rows. `204` |
| `GET /api/home?scope=mine\|everywhere` | as today, plus the changes below |

`GET /api/home` additions (additive, ADR-033):
- `scope: 'mine' | 'everywhere'`: what was applied. Default (`scope` omitted) is `mine` when the caller has any history (a view or a document they created in the last 90 days), else `everywhere`. `hasHistory: boolean`.
- `drafts` counts and lists only never-published documents whose `created_by` is the caller (`drafts.total` too), newest first.
- `recent` under `mine` is limited to workspaces where the caller has a `document_views` row or a created document in the last 90 days, and leaves out documents whose `updated_by` is the caller. Each item gains `updatedBy: { id, name } | null`.
- `jumpBackIn`: up to 8 `{ id, shortId, slug, title, workspaceId, viewedAt }` the caller opened most recently, only those they can still view.
- Each `stats` row gains `engagement: integer` (views plus created documents in the workspace in the last 90 days, 0 if none).

## Notifications (ADR-052 step 4)

`notifications (id, recipient_user_id, kind, document_id, request_id, actor_user_id, created_at, read_at)` with kinds `review-requested`, `changes-requested`, `review-approved`, `review-withdrawn`; index `(recipient_user_id, created_at desc)`; rows older than 90 days are deleted by the job runner.

An outbox consumer on `ReviewRequested`, `ReviewDecided` and `ReviewWithdrawn` writes rows: a request notifies each assigned person and each member of an assigned group (never the requester); a decision that settles the request (`approved` or `changes_requested`) notifies the requester; a withdrawal or supersession notifies the people who had been asked and, for those, marks their unread `review-requested` rows for it read. It must be idempotent per event.

| Route | Does |
| --- | --- |
| `GET /api/me/notifications?limit=&before=` | `{ items: { id, kind, document: {id, shortId, title, workspaceId}, actor: {id, name}, at, readAt: string \| null }[], unread: number, next?: string }`, newest first, default limit 20, documents the caller can no longer view left out |
| `POST /api/me/notifications/read` `{ ids?: string[] }` | marks those (or all) read. `204` |
