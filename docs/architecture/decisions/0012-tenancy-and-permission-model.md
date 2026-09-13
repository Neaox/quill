# ADR-012: Tenancy and permission model

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 12; decisions D8, D13, D14; research R6

## Context

One deployment serves one organisation, but that organisation may contain companies, departments, and teams, each needing privacy from the others. Share links and public publishing require permissions for people without accounts.

## Decision

- **Instance** is the root of an **organisational unit** tree of arbitrary depth. Each unit has an admin-chosen label. Units are private by default.
- **Workspaces** belong to a unit. **Collections** are first-level containers inside a workspace and carry their own grants and publish settings. **Documents** nest below collections and belong to exactly one place in the tree.
- **Principals** are users, groups (scoped to a unit, nestable), the **public** principal, and **share links**.
- A **grant** attaches a **role** (viewer, contributor, editor, admin, owner) to a principal at a scope (unit, workspace, collection, document). Effective permission is resolved by walking from the document up to the instance; the most specific grant wins; an explicit deny at document scope supports private documents. See the amendment of 2026-09-12 for exactly what "most specific" means once a request holds more than one principal.
- An **instance admin** role exists separately from workspace owner.
- Resolution is a pure domain function. A materialised effective-permission table, rebuilt from outbox events on grant changes, serves search filtering and list views.

## Amendment, 2026-09-12: resolution is per principal, then combined

The original wording — "the most specific grant wins" — did not say *whose*
grant. Read as "the nearest scope carrying any matching grant decides for the
whole identity set", it produces two unacceptable results, both of which were
reproduced before this amendment was written:

- A group allowed at a collection and a user denied at one document inside it
  disagreed with the materialised table, which dropped the deny and kept the
  group's row, so a list view showed a document a direct check refused.
- Every request holds the **public** principal, so adding a public viewer grant
  at a collection made that collection "the nearest scope with a matching
  grant" and demoted an editor granted at the workspace to viewer. Signing in
  took access away, which the model says it must never do.

The rule is therefore stated per principal:

1. **Each principal contributes once.** For every principal a request holds,
   its contribution is the nearest scope on the document's chain that carries a
   grant for *that principal*. If the deciding grant there is a deny, the
   principal contributes a deny at that scope; otherwise it contributes the
   highest role among its allows there. Within one scope a deny always beats an
   allow.
2. **The contributions are then combined**, and what a deny does depends on
   whether it names a person or a channel:
   - A deny on a **user or a group** withdraws the document from that person
     however else they reach it, so it discards every allow whose scope is not
     *strictly* nearer the document than the deny, whoever holds that allow.
   - A deny on the **public principal or a share link** closes a channel, not a
     person, so it removes only that principal's own contribution and never
     touches an allow held through a user or a group.

   The effective role is the highest role among the allows that survive, or none
   if there are none.

What follows from it, and what the tests are named after:

- An explicit allow nearer the document than an inherited deny wins: a deny is
  withheld access from its own scope downwards, and a grant below it is a
  deliberate exception.
- A deny at the same scope as an allow wins, whichever principals hold them.
- A public or anonymous allow can only widen a signed-in reader's access, never
  narrow it, because it can only lower the public principal's own contribution.
- A group can be made read-only for a collection — its own nearer viewer grant
  lowers that group's contribution — without lowering a member who holds a
  nearer or wider grant through another principal.
- A document can be carved out of a public collection: a viewer grant to
  `public` at the collection and a deny to `public` at the document takes that
  one document off the public web, and members who reach it through their own
  user or group grant still see it. The same carve-out on a share link closes
  that link only.

The person-or-channel distinction is the reason the second half of rule 2
exists. A public grant models *publication* — a public collection is a viewer
grant to `public` — not membership, and every request carries the public
principal. If a deny on `public` discarded other principals' allows, unpublishing
one document would also hide it from the people who write it, which is not what
an administrator asked for. Denying a person is different: it is a statement
about them, and it must hold whichever door they came through.

Two mechanical requirements follow, because the bug was a second implementation
of the same rule drifting from the first:

- **One combine function.** `combineContributions` in `packages/domain` is the
  only place the rule is written. `resolvePermission` ends in it, and so does
  every consumer of the materialised table.
- **The materialised table stores contributions, not conclusions.** A row is
  emitted per (document, principal) including denies, and carries the deciding
  scope and its depth on the chain, because a consumer cannot tell an inherited
  deny from an allow written below it without knowing where each one sat.
  Consumers take the rows for the principals a request holds and combine them.

Finally, the grant rules — deny only at document scope, the public principal
never above viewer — are enforced at the application boundary by a `createGrant`
use case that calls the domain's `validateGrant` before writing. A pure
validator nothing calls protects nothing.

## Alternatives considered

- **Fixed levels (organisation, company, team).** Rejected: a third level would force a rewrite.
- **Multi-tenant from the start.** Rejected: no hosted offering is planned; a tenant column can be added if that changes, and an instance-per-tenant deployment works without it.
- **Permissions checked ad hoc in routes.** Rejected: unsafe and untestable.

## Consequences

- The public principal exists from milestone M1 even though nothing is public until M3.
- SCIM group provisioning later maps onto groups and units without schema change.
- R6 measures resolver and materialisation cost at 10,000 documents and 1,000 grants.
