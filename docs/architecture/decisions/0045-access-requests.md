# ADR-045: Access requests

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-011 (security baseline), ADR-012 (tenancy and permission model), ADR-034 (settings), ADR-035 (human-readable URLs), quill-plan.md section 22 (events, jobs and notifications)

## Context

People are sent links to pages they cannot open. A colleague pastes a runbook link in a chat, or a ticket links a design document in another team's workspace. Today the signed-in reader gets a refusal and nowhere to go. In Confluence, Google Docs and Notion, the reader asks for access in one click, and someone who can grant it decides.

The owner's requirements:
- An authenticated user who has a link to a page they may not read can request access, with an optional message. They may lack access implicitly, or through a role, group or team.
- A request is **approved**, **deferred** or **declined**.
- The requester is notified when it is approved or declined.
- **Defer** is offered only if someone else can review the request.
- Reviewers are reminded periodically about pending requests.

## Decision

### Who can ask, and what they see

- **Signed-in users only.**
  - An anonymous visitor following a protected link is asked to sign in first (and comes back to the link afterwards).
  - Share-link and public readers never see a request form. Those principals are channels, not people (ADR-012).
- **What they may ask for.**
  - A user with **no** read access asks to view.
  - A user who can view but not edit, on a page they reached, may ask for edit access from the page's menu. It is the same mechanism with a different requested role.
  - The requested role is one of viewer, contributor or editor. Admin and owner are never requested; they are given.
- **Existence is not disclosed beyond what the link already reveals.**
  - The refusal page says "You need access to this page" and shows the workspace's name only if the user can see that workspace. It never shows the title, the collection, or any content.
  - **What a dead link shows depends on whether its address can be guessed.**
    - **Document links carry an unguessable short key** (ADR-035: `/d/<title-slug>-<key>`, about 50 bits), and their readable part is already in the reader's hands.
      - For a signed-in user, a key that never existed gives an honest **"This page doesn't exist"** (404).
      - A key whose document was **deleted** gives **410 Gone**, "This page was deleted", but only to those who could read it. It offers a restore to anyone who may restore it. Everyone else sees the refusal they would have seen before (see "A deleted page keeps the original's access restrictions").
      - Both offer suggestions (see "Dead links" below).
      - The difference from "you need access" discloses nothing the link didn't: nobody can find documents by trying keys, and requests for nothing are a worse experience than a clear 404.
      - Anonymous visitors are asked to sign in first in every case, so the distinction is only ever shown to members.
    - **Guessable addresses get one uniform answer.** These are workspace and collection slugs (`/w/mergers`), and a bare title slug with no key.
      - A workspace that does not exist and one the user cannot see give the same "not available" page, with the request form where policy allows it. Otherwise any member could probe whether a confidential workspace exists.
      - A request against something that does not exist is discarded silently and rate-limited like a real one.
    - **Whatever the address, probing is rate-limited per user.** A burst of misses is audited, so enumeration attempts are visible even where they cannot succeed.
- **A deliberate deny ends the conversation.**
  - If the user is denied the page by an explicit deny on them or one of their groups (ADR-012), the page says "You don't have access to this page" and offers no request. Somebody already decided.
  - Organisations that want denied users to be able to ask can turn on "Allow requests despite a deny". Reviewers then see the deny prominently.

### Dead links

What a reader sees at a deleted, withdrawn, moved or non-existent address is decided in [ADR-046](0046-deletion-unpublishing-and-dead-links.md). That covers the Trash and its restore window, tombstones, 404/410/301, replacements and messages, and permission-safe suggestions. Its first rule is that a removed page keeps the original's access restrictions: anyone it was hidden from sees exactly the refusal described above.

### The request

- **Contents:**
  - the requester;
  - the target (the document the link named, by id; ADR-035's addresses resolve to it);
  - the requested role;
  - an optional message, plain text up to 1,000 characters.
- **One open request per requester and target.** Asking again updates the message and moves it up the reviewers' queues. It does not duplicate.
- **Limits:**
  - a requester may have at most 20 open requests;
  - after a decline, the same target can be requested again only after 7 days, or sooner with a new message the reviewer will see;
  - all of it is rate-limited per user.
- **The requester can see and withdraw their own requests** in Settings → You → Access requests.

### Who reviews

The **eligible reviewers** of a request are every person who could grant the requested role at the target: anyone holding `manage` (admin or owner) at the document or any scope above it, resolved with the same domain functions as every permission check (ADR-012). A group grant contributes its members.

**Routing.** Requests go to the reviewers at the **nearest** scope that has any, so a document's own admins are asked before the workspace owners and the instance.
- A workspace or collection may name **access managers**, a group or people, who receive its requests instead of its admins.
- Instance administrators are reviewers of last resort. They see a request only if no other eligible reviewer exists.

### Decisions

A reviewer opens the request from the notification, or from **Access requests** (a queue page listing pending requests they can review, oldest first). They see:
- who is asking, and their units and groups;
- the target;
- the requested role;
- the message;
- how the requester currently relates to the page, for example "Viewer through Platform team; editor requested", or "No access".

They choose one of:

- **Approve.**
  - The reviewer confirms or lowers the role. They can never raise it beyond what they themselves may grant.
  - They choose **how**:
    - a direct grant at the document (the default);
    - a grant at a broader scope they manage (collection or workspace);
    - adding the user to a group they manage that already has the access (recommended when one exists, to keep grants tidy).
  - The grant can optionally **expire** (7 days, 30 days, a date, or never).
  - The grant goes through the `createGrant` use case and its validation (ADR-012). The request closes as approved, and the materialised permissions update through the outbox as for any grant.
- **Decline.**
  - An optional reason goes to the requester.
  - The request closes as declined.
- **Defer.**
  - Offered **only if at least one other eligible reviewer exists** for this request at its current routing scope. If the reviewer is the only one, the action is not shown at all; a disabled button would invite a question with no useful answer.
  - Deferring hands the request to the others: it leaves the deferring reviewer's queue and reminders, stays in everyone else's, and records who deferred.
  - If everyone at a scope defers, the request escalates to the next scope up that has reviewers, if one exists.
  - Defer is not a decision, so the requester is not notified.

### Second opinions: revoking an approval, reconsidering a decline

One reviewer's decision is not final against everyone else's judgement. If someone decides it was a mistake, they can reverse it.

**Revoke an approval.** Any eligible reviewer of the request can revoke it at any time, not just the approver, and so can anyone who manages the scope where the grant was made.
- Revoking removes **exactly what the approval created**: the grant it wrote, or the group membership it added. The request records that by id.
- It never touches access the person holds by other means. The reviewer is shown that first ("Alex still has viewer through Platform team"), so nobody believes access is gone when it isn't.
- If the approval's grant has since been changed by hand, revoking shows the current state and asks before removing it.
- The requester is told their access was removed, with the reason if one was given. The title is shown, since they had access.
- The original approver is told who revoked it and why, so the disagreement is visible rather than silent.
- The request moves to **revoked**: a final state that keeps both decisions in its history.

**Approvals are visible to peers.**
- When a request is approved, the other eligible reviewers of that request get it in their next digest as "Recently approved by Sam", with Revoke beside it, for 7 days.
- Being told isn't a vote: an approval takes effect immediately. It gives anyone who disagrees the chance to say so.

**Reconsider a decline.**
- Any eligible reviewer can reopen a declined request within 30 days and approve it. The requester's cooldown is lifted, and the decliner is told.
- Nobody else is notified on reopening: a reopened request is either approved, which notifies the requester as usual, or left declined.

All reversals are audited: who, when, why, and the grant or membership affected.

**Closed by events, not just decisions.**
- **Granted elsewhere:** the requester gained the access some other way, such as being added to a group or granted directly by someone else.
- **Expired:** pending for 30 days. Configurable; the requester is told.
- **Withdrawn:** by the requester.
- **Moot:** the target was deleted. The requester is told only that the request closed, never why.

A request can be decided once. Decisions race through a compare-and-swap on the request's status, so two reviewers cannot both approve, and the loser sees "Already approved by Sam".

### Notifications

All through the outbox (plan section 22). In-app first, email second, both respecting each person's notification settings.

| Event | Who is told |
| --- | --- |
| `AccessRequested` | The routed reviewers, at once. |
| `AccessRequestApproved` | The requester: "You can now view …", with the link. Title shown now that they have access. |
| `AccessRequestDeclined` | The requester, with the reason if one was given. The title is withheld, as before. |
| `AccessRequestDeferred` | Nobody; the remaining reviewers' queues update. |
| `AccessRequestEscalated` | The next scope's reviewers. |
| `AccessRequestExpired` | The requester; reviewers drop it from their queues. |
| `AccessRequestRevoked` | The requester (access removed, with the reason) and the original approver. |
| `AccessRequestReopened` | The original decliner. |

**Reminders.** A scheduled job sends each reviewer a **digest** of requests still pending in their queue. It sends nothing to someone with none.
- The first digest goes after 1 working day, then every 2 working days, then weekly after 2 weeks. The schedule is configurable per organisation.
- A request pending for 5 working days with no decision escalates to the next scope's reviewers, if any, and the digest says so.
- Digests are one message per person, never one per request, and link to the queue.
- The app shows a count of pending requests beside the person menu for anyone who has some to review.

### Policy and audit

Organisation settings (ADR-034) control:
- whether access requests are on;
- whether requests are allowed despite a deny;
- the expiry and reminder schedules.

Workspaces may turn requests off for themselves, for example for a confidential workspace, where the refusal page simply says to contact the owner.

Every request, decision, deferral, escalation, expiry and resulting grant is audited, with who, when and what. Messages are stored and shown only to reviewers and the requester. They are not written into the audit, and are deleted with the request when it is purged (90 days after closing).

## Alternatives considered

- **Email the owner a link.** It isn't tracked, so there is no queue, no deferral and no reminders, and the requester never hears back. That is the experience being replaced.
- **Notify every eligible reviewer up the tree at once.** It spams instance administrators for every document request. Nearest-scope routing with escalation reaches the right people first.
- **One uniform "not available" answer for every miss, document keys included.** This was the first draft. It protects nothing for keyed links, because a member cannot find a key by guessing and already holds the one they have. It also sends people with a typo or a deleted page into an access request for nothing. It is kept only for guessable addresses.
- **Show the page title on the refusal page.** It leaks the existence and subject of private documents to anyone with the address (Google Docs withholds it for the same reason).
- **Offer Defer to a sole reviewer.** It parks the request with nobody, which is worse than a visible pending item. The owner's rule is that Defer exists only when someone else can review.

## Consequences

- A new aggregate, `AccessRequest`, in the domain: its status union, the routing function and the defer rule are pure, testable functions over the permission model. It has an `access_requests` table, outbox events, a reminder and expiry job, a queue page, a refusal page, and settings.
- Reviewers' queues depend on resolving "who can manage this", which the materialised permission table should answer in one query, not by walking per request.
- End-to-end tests cover:
  - request, approve, view;
  - request, decline, and the cooldown;
  - defer with two reviewers, and no defer with one;
  - escalation;
  - reminders on a fake clock;
  - revoking an approval, including access the requester also holds another way;
  - racing approvals.

## Delivery

M3/M4, alongside share links (`docs/architecture/api-contract-share-links.md`):
1. The domain aggregate, routing and the defer rule.
2. The refusal page and the request form, with enumeration safety.
3. The queue page and decisions (approve via `createGrant`, or adding to a group).
4. Notifications, the reminder and escalation job, and settings.
