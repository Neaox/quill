# @quill/domain

Entities, value objects, and rules. Pure TypeScript: no React, Fastify, Drizzle, or provider SDKs, and no I/O.

An **instance** is the root of an **organisational unit** tree of any depth, each unit labelled by an administrator. **Workspaces** belong to a unit, **collections** are first-level containers in a workspace, and **documents** nest below a collection in exactly one place.

A **grant** gives a **role** (viewer, contributor, editor, admin, owner) to a **principal** (user, group, public, share link) at a **scope** (instance, unit, workspace, collection, document), with an effect of allow or deny. `validateGrant` enforces the two standing rules: deny only at document scope, and the public principal capped at viewer.

`buildScopeChain` lists the scopes governing one document, most specific first: the document, each ancestor document up to the root of its collection (nearest first), the collection, the workspace, each unit up to the root, and the instance. It reports a broken unit or document tree rather than looping. A grant on a document therefore reaches its whole subtree, which is what lets a share link scope to "this document and everything under it" rather than to one page at a time; deny still only ever applies at document scope, ancestors included, so one private document can be carved back out of an otherwise shared subtree. `principalIdentities` expands a request into the principals it holds: the user, their groups and the groups those nest inside, the public principal, and any share link.

`resolvePermission` answers the question. The most specific scope on the chain carrying a matching grant decides; a deny there beats every allow; otherwise the highest role wins. `materialiseEffectivePermissions` produces the same answers for a whole workspace in one pass down the tree, as rows for the search index and list views.

See [ADR-012](../../docs/architecture/decisions/0012-tenancy-and-permission-model.md).
