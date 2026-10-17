# ADR-052: Publish capability and review requests

**Status:** Accepted
**Date:** 2026-10-13
**Related:** ADR-012 (tenancy and permission model), ADR-015 (versioning and publish semantics), ADR-021 (draft and locking), ADR-033 (backward compatibility), ADR-045 (access requests), quill-plan.md sections 13, 22 and M6, open question 5

## Context

Today anyone who can **edit** a document can **publish** it: every route that publishes (`publish`, `restore`) checks `edit`, and `Capabilities` is a pure function of one linear role rank. The `contributor` role exists, and its comment in `roles.ts` says it may "comment and propose changes but not publish", but nothing implements proposing, and no route checks `comment`.

The owner's requirements:
- People who can edit but not publish.
- Anyone should be able to ask for **extra eyes** on a draft before it goes live, whether or not they could publish it themselves.
- A polished review experience, in which the author can **tag a team, a group, or named people**.

What exists to build on: groups and group membership (domain, tables, repository), grants that target groups, the outbox and its consumers, `comment_threads` tables without code, `document_locks`, per-block draft authorship, and the "Review changes" diff of draft against published. What does not: any route or screen for groups, members or grants; a way to search people or groups; any notification, inbox or review-request entity; mail other than sign-in mail.

## Decision

### 1. A `publish` capability, carried by roles

`Capabilities` gains `publish`. Roles stay one linear rank, so nothing about how grants resolve changes (ADR-012):

| Role | view | comment | edit (draft) | publish | manage | own |
| --- | --- | --- | --- | --- | --- | --- |
| viewer | yes | | | | | |
| **contributor** | yes | yes | **yes** | | | |
| editor | yes | yes | yes | **yes** | | |
| admin | yes | yes | yes | yes | yes | |
| owner | yes | yes | yes | yes | yes | yes |

- **A contributor is the person who writes but does not publish.** Their draft, locks, attachments and new documents work as an editor's do; what they cannot do is make a revision.
- **No existing access narrows.** Editors keep publishing. Contributors were never usable (nothing checked `comment`), so giving them draft editing widens, never narrows (ADR-033). No migration: roles are plain text.
- `publish` guards `POST /api/documents/:id/publish` and `.../restore`. `revert-preview` and compare stay on `edit`. Publishing a *collection to the web* (`publishCollection`) is a different act, stays on `manage`, and is unchanged.
- The envelope exposes `permissions.publish`. The web reads it: an author without it sees **Request review** as the primary action where an editor sees **Publish**, and a disabled Publish with its reason ("Contributors ask for a review") where that reads better (frequent control, so disabled rather than hidden).

### 2. Review requests

A **review request** asks named people and groups to look at the draft as it is now.

- **Entity.** `review_requests`: document, requester, the draft's version and content hash at the time, an optional message (plain text, 1,000 characters), status (`open`, `approved`, `changes_requested`, `withdrawn`, `superseded`, `published`), timestamps. `review_assignments`: request, principal (user or group), state (`pending`, `approved`, `changes_requested`), the person who actually decided (a group is answered by any one member), their comment, time.
- **One open request per document**, like ADR-045. Asking again replaces the reviewers and message and supersedes the earlier request.
- **Who can ask:** anyone with `edit`. Whether they can also publish does not matter: an editor may want a second pair of eyes too.
- **Who can be tagged:** a person or group that can **view** the document. Someone who cannot is shown, disabled, with the reason. A person with `manage` may offer to grant access from the same dialog (reusing ADR-045's grant path). Candidates come from a permission-safe `GET /api/documents/:id/reviewer-candidates?q=`, which never lists anyone the caller could not already see by other means.
- **What a reviewer does:** reads the same compare view as "Review changes" (draft against published), **approves** or **requests changes**, each with an optional comment. Comments on the proposed change attach to threads when comments land (M4); until then the decision's comment is the whole conversation.
- **Edits after a request.** The request records the draft it was made against. If the draft changes afterwards, approvals are flagged **Changed since approved** and reviewers see what changed since; nothing is silently lost and nothing is silently stale.
- **Publishing.** Approval does not publish. Someone with `publish` does: the author if they have it, otherwise any reviewer or editor with it, through **Approve and publish** (offered to a reviewer who holds `publish`) or the plain Publish. A publish closes the request as `published`.
- **State shown, not stored on the document.** The envelope gains a derived `review` (state, who has answered, who is pending). `documents.status` is not changed; `in-review` can be added later without a migration if it is wanted.

### 3. Notifications, in-app first

- `ReviewRequested`, `ReviewDecided`, `ReviewWithdrawn` are outbox events in the same transaction as the change (ADR-033 versioned payloads).
- A consumer writes **`notifications`** rows (recipient, kind, target, read-at). A group's members each receive one. The bell and a **Needs your attention** section on home read them.
- Email is a second step: a new mail kind and `Mailer` method, per-person setting, and one reminder (as ADR-045). Sign-in mail is unaffected.
- Audit events for every request and decision, without comment bodies.

### 4. The experience

- **Document header.** A single status chip: "In review: 1 of 3 approved". Primary action by capability: Publish, Request review, or (during review) Withdraw.
- **Request dialog.** A multi-select combobox for people and groups (chips, avatars, group sizes), a message, and a plain summary of what changes ("12 lines added, 3 removed, 2 sections"). Frequent reviewers are suggested first.
- **Review view.** The compare view with a bar: Approve, Request changes, comment. Decisions are visible to everyone on the request.
- **For the author.** Feedback arrives on the document and on home; changes requested put the draft back at the top of Continue writing with the reason.

### 5. Policy, later

Open question 5 (per-document approval versus required reviewers) is answered by a **collection policy** in a later step: "Publishing needs approval from N people or from group G", making even an editor ask. It reuses everything above and adds only a gate on `publish`.

## Alternatives considered

- **A separate `publisher` role above editor.** Rejected: it narrows what "editor" means for every existing grant, breaking ADR-033.
- **Orthogonal per-capability grants.** Rejected for now: a new concept in the resolver and a migration for a case one new rank covers; a collection policy covers the rest.
- **Reviewing with the existing draft lock.** Rejected: a review must not block the author's writing.
- **Store `in-review` on the document.** Rejected: derived state cannot drift from the request.

## Consequences

- **Easier:** safe contribution from people who should not publish; a second pair of eyes for anyone; the same plumbing serves comments, mentions and access requests.
- **Harder / new surface:** groups finally need screens (membership at least read-only), a directory with its own privacy rule, and the notification inbox. These are foundations, not review-only features.
- **Revisit** if organisations need a person who publishes but cannot edit, or per-capability grants.

## Delivery

1. `publish` capability, route guards, envelope, web gating, tests.
   (Decided with the owner, 2026-10-13: contributor edits and cannot publish; the first build is steps 1 to 4 plus a **members and groups admin screen** beside the permission-safe picker.)
2. Review request and assignment tables, use cases, routes, reviewer candidates.
3. Request dialog, review view, header chip.
4. Notifications table, consumer, bell, home "Needs your attention".
5. Email, reminders. 6. Collection policy.

## API contract (first build)

All routes need a session. Errors use the existing `{ error: { code, message } }` shape.

```ts
type ReviewStatus = 'open' | 'approved' | 'changes_requested' | 'withdrawn' | 'superseded' | 'published'
type AssignmentState = 'pending' | 'approved' | 'changes_requested'
interface PersonRef { id: string; name: string }
interface ReviewRequestDto {
  id: string
  documentId: string
  status: ReviewStatus
  requestedBy: PersonRef
  message: string | null           // plain text, at most 1,000 characters
  createdAt: string                // ISO
  draftVersion: number             // the draft this was asked about
  stale: boolean                   // the draft has changed since
  assignments: {
    id: string
    reviewer: { kind: 'user' | 'group'; id: string; name: string; memberCount?: number }
    state: AssignmentState
    decidedBy: PersonRef | null    // for a group, the member who answered
    comment: string | null
    decidedAt: string | null
  }[]
  canDecide: boolean               // the request is open and the caller is assigned, directly or through a group
  canWithdraw: boolean             // the request is open and the caller made it or has `manage`
}
```

| Route | Needs | Does |
| --- | --- | --- |
| `GET /api/documents/:id/review` | `view` | `{ request: ReviewRequestDto \| null }`: the open request, or the latest closed one. A caller who can neither `edit` nor was assigned (directly or through a group) gets `{ request: null }`, which reveals nothing; `403` is only for a caller with no `view` |
| `POST /api/documents/:id/review` `{ reviewers: {kind, id}[], message? }` | `edit` | `201 ReviewRequestDto`. 1 to 20 reviewers, each of whom must be able to view the document; an earlier open request becomes `superseded`. `422 reviewer_cannot_view` names who |
| `POST /api/documents/:id/review/decision` `{ decision: 'approve' \| 'request_changes', comment? }` | being assigned | `ReviewRequestDto`. A group assignment is answered by any one member. Overall status: any `changes_requested` makes the request `changes_requested`; all approved makes it `approved` |
| `DELETE /api/documents/:id/review` | the requester, or `manage` | withdraws the open request: `204` |
| `GET /api/documents/:id/reviewer-candidates?q=` | `edit` | `{ people: {id, name, email, canView}[], groups: {id, name, memberCount, canView}[] }`, at most 20 of each, matching `q` by name. Only people who can already see this document by a grant on its chain, and members of groups that can; `canView:false` entries only for a caller with `manage` |
| `GET /api/me/attention` | | `{ items: { kind: 'review-requested' \| 'changes-requested' \| 'review-approved', requestId, document: {id, shortId, title, workspaceId}, by: PersonRef, at }[] }`: review requests waiting on the caller (their own, or a group's) and answers to the caller's requests, newest first, at most 20 |

Someone assigned on the **open** request may also read the draft-against-published comparison (`GET /api/documents/:id/compare?to=draft`, and `compare/source`) without `edit`: nothing else about the draft opens to them (no write, no lock, no raw draft). Publishing a document closes its open request as `published`. Editing the draft sets `stale` on the open request. `ReviewRequested`, `ReviewDecided` and `ReviewWithdrawn` outbox events carry the request id, document id and actor (versioned, ADR-033). Every request and decision is audited without comment bodies.

### People and groups (admin)

| Route | Needs | Does |
| --- | --- | --- |
| `GET /api/groups` | instance admin | every group with `{ id, name, unitId, unitPath, memberCount, parentGroupId }` |
| `POST /api/groups` `{ unitId, name, parentGroupId? }` | instance admin | create |
| `PATCH /api/groups/:id` `{ name }`, `DELETE /api/groups/:id` | instance admin | rename, delete |
| `GET /api/groups/:id/members` | instance admin | `{ members: {id, name, email}[] }` |
| `PUT /api/groups/:id/members/:userId`, `DELETE /api/groups/:id/members/:userId` | instance admin | add, remove |
| `GET /api/people?q=` | instance admin | `{ people: {id, name, email}[] }`, at most 20, for adding members |

## Security review (docs/security/checklist.md, 2026-10-17)

- **Authorisation.** Every review route resolves through `requireDocumentAccess` or the authorizer's identities; the new `publish` capability is a pure function of the role rank, so no grant, deny or share-link rule changed. A share-link principal never holds `publish` (view-only). Reviewer access to the draft comparison is limited to the assignees of an **open** request and ends when it closes; the raw draft, the lock and every write stay behind `edit`.
- **Candidates are permission-safe.** `reviewer-candidates` lists only people and groups who can already view the document (plus, for `manage`, those who cannot, marked); `422 reviewer_cannot_view` names only the ids the caller supplied.
- **Input.** Review and group bodies refuse unknown fields (`additionalProperties: false` under the strict validator), with length and count limits; the group member id is pattern-checked.
- **Admin actions audited.** Group create, rename, delete and membership changes, and every review request, decision and withdrawal, are audit events without comment bodies. Group routes are instance-admin only; `GET /api/people` is admin-only.
- **Privacy.** Viewing history (ADR-053) is the caller's own, read through no other route, deleted on request and after 90 days.
- **Follow-ups, not blocking.** There is no per-route rate limit on `reviewer-candidates` or `GET /api/people` (the repository has no limiter pattern for authenticated reads yet); a requester can tag themselves; the comparison pane is titled "Your draft" for a reviewer who did not write it.
