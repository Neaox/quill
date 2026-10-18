# ADR-055: Authorship and ownership

**Status:** Accepted
**Date:** 2026-10-17
**Related:** ADR-012 (tenancy and permissions), ADR-052 (publish capability and review requests), ADR-053 (home relevance: `created_by`), ADR-005 (front matter `owners`), ADR-021 (drafts and locking), ADR-045 (access requests), ADR-046 (deletion), ADR-054 (template library); research [`2026-10-17-templates-and-edit-permissions.md`](../../research/2026-10-17-templates-and-edit-permissions.md)

## Context

ADR-012 resolves a role per principal at the nearest scope and combines the results. Roles run `viewer < contributor < editor < admin < owner`. ADR-052 split publishing from editing: a contributor writes drafts and asks for a review, and an editor publishes. Three things follow today:

- **Everyone who can edit edits every document in scope.** Nothing looks at who wrote what.
- **Rename, move and delete need `manage`** (`routes/documents.ts`). So a writer who makes a document by mistake cannot delete it, and cannot fix its title without asking an administrator.
- **A creator is recorded, but nobody is accountable.** ADR-053 added `documents.created_by` so home can show "mine". It is a fact about the past and grants nothing. Front matter `owners` is a descriptive list that also grants nothing, and it is content, so a Git push can change it.

ADR-054 needs an owner for templates: the person who may change a shared one and decide who else may. Asking "who owns a template?" raises the same question for documents.

The research write-up finds that every wiki studied lets an editor edit everyone's pages. In those products the owner is the accountable person, not the only editor, and deleting, moving and sharing are guarded harder than editing.

## Decision

**The wiki default stays.** Anyone the resolver gives `edit` on a document edits it, whoever made it. "Only your own" is not offered as a default. A narrower page is made with a document-scope grant or deny (ADR-012), and changes that need sign-off wait for the review workflow (M6).

**Every document has a creator and an owner, recorded in the database.**

- **One new column.** `documents.created_by` already records the person who created a document and never changes (ADR-053). `documents.owner_id` is added for the accountable person: it starts as the creator, and the owner or anyone with `manage` can change it.
- **Existing documents.** `owner_id` is filled from `created_by` where that is known. Where it is not, it stays empty and the document behaves as today.
- **Not in front matter.** These are permission data. A push to the content store must not be able to make someone an owner, so they live with grants (ADR-034).
- **The `owners` field.** Front matter `owners` stays what ADR-005 made it: who to ask. The creator is suggested into it at creation, and the two are shown together where they differ.

**Owning a document widens what you may do with it, never whether you may reach it.** The authorizer gains one step after `resolve`. If the person is the document's owner, and the resolved capabilities already include the right base, they also get these rights for that document. The base is `edit` for a document that has never been published, and `publish` for one that has: deleting, moving or renaming a published page changes what readers see, which is exactly what ADR-052 keeps from contributors. A contributor who owns a draft can tidy it; once it is published, its contributor owner asks an editor, as for any change readers will see.

- rename and retitle it;
- move it, to any place where they also hold `edit` (the target check is unchanged, only the role it asks for);
- delete it, to trash, under ADR-046's rules;
- manage its share links and its document-scope grants;
- take over its lock (ADR-021);
- transfer ownership.

The owner gains no right over the workspace, the collection or other documents.

**Why ownership grants nothing on its own.** Ownership is not a grant, and it is applied only on top of what the resolver already gives. Taking someone out of a workspace takes everything with it: there is no document-scope grant left behind that would keep a former member in their old pages. A document-scope `admin` grant written at creation was considered and rejected for exactly this leak.

**Contributors keep ADR-052's rules.** A contributor writes drafts and creates documents, edits anyone's draft that they can reach, and asks for a review to publish. Ownership gives a contributor rights only over documents of theirs that have never been published.

**Templates use the same owner, under a stricter policy.** A shared template is changed by its owner, the maintainers the owner names, and the workspace's managers, not by every editor (ADR-054).

## Alternatives considered

- **Editors edit only their own documents unless granted.** Rejected. No wiki studied defaults to it, and it defeats the point of a team's documentation: the person who notices the wrong port number fixes it.
- **Leave rename, move and delete at `manage`.** Rejected. A writer cannot tidy their own mistakes, and administrators become a queue for trivial requests.
- **A document-scope `admin` grant to the creator.** Rejected. It outlives the person's membership and keeps them in documents they should have lost.
- **Owner from front matter `owners`.** Rejected. It is content, editable by a push, and lists the people to ask, who are not necessarily anyone who should be able to delete.
- **Give the editor role rename, move and delete everywhere.** Rejected. Deleting and moving affect readers who did not ask for the change. The research finds every product guards them harder than editing, and the owner is the person accountable for the page.

## Consequences

- **The server.** `documents` gains `owner_id`, backfilled from `created_by`. The ownership step goes in `packages/application/src/use-cases/authorizer.ts`. The routes that require `manage` for rename, move, delete, share links and lock take-over ask for the document capability the step can grant, not the role.
- **The materialised permission table** (ADR-012) is unaffected. Ownership changes no one's access, so list views and search filtering still read only grants.
- **The interface.**
  - Rename, Move, Delete and Share appear for the owner of a document wherever they appear for a manager.
  - A document's details show its owner and creator.
  - Transferring ownership is an action in the document's menu.
- **Audit.** Changing an owner is audited like a grant change.
- **Review.** This changes who may do what, so it runs `docs/security/checklist.md`, and the change to the routes is reviewed against ADR-012's resolver.
