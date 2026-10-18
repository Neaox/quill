# ADR-049: The navigation tree: order, lazy children and a windowed list

**Status:** Accepted
**Date:** 2026-10-12
**Related:** ADR-012 (permissions), ADR-031 (render caching), ADR-033 (compatibility), ADR-035 (readable URLs); `quill-plan.md` sections 9.5 and 31

## Context

The workspace tree is one request, `GET /api/workspaces/:id/tree`, that returns every document the reader may see, nested to any depth. The sidebar renders all of it, always expanded, with a menu on every row. Reading the code against the budget in `quill-plan.md` section 31 ("Workspace tree: 10,000 documents without virtualisation problems"):

- the payload grows with the workspace (about 150 bytes a document, so about 7 MB at 50,000), is refetched whole on focus and on every mutation, and has no validators;
- the page builds about seven elements and a menu root per document, so 50,000 documents is some 350,000 nodes for a column that shows forty rows;
- siblings have no `ORDER BY`: their order is whatever the database returns, which is not stable, and the public site sorts by title where the app does not;
- there is no way to say that a collection is a log, whose newest entries belong first.

None of this is visible at the fifty documents a demo has. All of it is the first thing a large workspace meets.

## Decision

### Order is deterministic and belongs to the parent

Siblings are ordered by `(sort_key, created_at, id)`. `sort_key` is the sparse integer `order` front-matter field of `quill-plan.md` section 9.5 projected onto the row, null for a document that has none; nulls sort after every key, then oldest first, so **a new document goes at the bottom** and nothing moves when it does. That is the order every list a person curates has (a to-do list, a table's rows, a page tree), and it is the default.

A collection, and a document with children, can say its children are `manual` (that order), `newest` first, `oldest` first, or by `title`. A log such as a retrospective wants `newest`: the entry written today is the one a reader came for, and the older ones are one "Show more" away. The mode belongs to the parent, because it is a property of what the list is, not of one entry. The public site reads the same order.

### Children are loaded a level and a page at a time

`GET /api/workspaces/:id/tree/children?collectionId=&parentId=&cursor=&limit=` returns one page of one parent's children, each with the count of its own children so a row knows whether it can be opened. The cursor is a keyset over the order above (never an offset, so an insert does not shift a page), the page size is bounded, and a page is answered from `(collection_id, parent_id, …)` with one grouped query for the counts. Nothing in the response grows with the size of the workspace, only with the page.

`GET /api/workspaces/:id/tree` stays as it is (ADR-033: additive within a version), for clients that have it, and gains no new users in the app.

Which documents a reader may see is, for now, still answered by the whole-workspace pass of `visibleDocumentIds`, because it is the pass that makes the flat list and the tree agree. An instance administrator skips it. Making it per level is the effective-permission table `quill-plan.md` already lists for M3; until then a non-administrator pays that pass on the server per request, and nothing more in the browser.

### The sidebar shows a window of rows, not the tree

The tree keeps which nodes are open (and loads a node's first page when it opens), flattens what is open into rows, and draws only the rows in view with a windowed list (`@tanstack/react-virtual`, the same family as the router and the query cache we already use). Rows are `role="treeitem"` with `aria-level`, `aria-setsize` and `aria-posinset`, because a windowed tree must say what the rows it does not draw are. One actions menu serves every row. The ancestors of the open document are opened for it, so it is always found. A mutation invalidates the parent it changed, not the workspace.

## Consequences

- The sidebar's cost is the rows in view and the pages opened, whatever the size or depth of the workspace; the network cost is a page.
- Ordering becomes a stored property, so it needs a migration (expand only: nullable and defaulted columns) and a projection from front matter in the publish consumers.
- The child-documents block, the child count and the move picker use the same per-parent pages, and stop needing the whole tree.
- A benchmark of 50,000 documents by 12 levels sits beside `search.bench.ts`, and a component test asserts the number of rows in the DOM is bounded; both are recorded against the budget in section 31.
- A new runtime dependency, `@tanstack/react-virtual`, with this as its reason: windowing a list is the established way to keep a long list's cost to what is on screen, and writing our own would be the same code with fewer edge cases handled.

## Alternatives considered

- **Paginate the whole tree by depth.** Still returns what is not on screen.
- **Offset paging.** An insert during a read repeats or skips a row; a log gets inserts constantly.
- **Order by title always.** Right for a glossary and wrong for everything a person arranged.
- **Order in workspace settings.** One reorder would contend with every other settings write (ADR-034's compare-and-swap).

## Amendment, 2026-10-17: the tree as built loads slices into nested lists, not pages into a window

The sidebar that shipped (`.changelog/20261017-document-tree-scales.md`) meets this decision's goal, a cost that is the rows on screen and the pages opened rather than the size of the workspace, by a different route for two of its three parts. This records what is there, so the record describes the product; it does not decide the question again.

- **Loading.** `GET /api/workspaces/:id/tree` takes `depth`, `limit` and `focus` and answers one level, a page of each list and the way down to the document being read, with every list's total. `GET /api/workspaces/:id/tree/children?collection=|parent=&offset=&limit=` answers a further slice of one list. The sidebar keeps every list as the contiguous slice it holds (`apps/web/src/lib/api/navigation-tree.ts`). The keyset-cursor endpoint and `GET /api/documents/:id/tree-position` described above were built on `main` and are not in the merged product: the `focus` parameter answers where a document is in the same request. **This is offset paging, which "Alternatives considered" rejected** because an insert can repeat or skip a row. A list is re-read whole when the tree is invalidated, which bounds the effect to a page being briefly out of step, but the trade-off is open and is the owner's to settle.
- **Drawing.** `Tree` (`packages/ui/src/components/tree.tsx`) draws real nested lists, a page of each branch with "Show N earlier" and "Show N more", and nothing of a closed branch, rather than a virtual window onto flattened rows: list navigation, find in page and the tab order work unchanged, and the long tail is a press away. From the windowed design it keeps: `aria-posinset` and `aria-setsize` on a branch drawn a window at a time, the collection heading pinned while its documents scroll beneath it, the document being read opened to and scrolled to (within the tree's own region only), and a list whose slice could not be had says so with "Try again" rather than loading for ever. `VirtualTree` stays in `@quill/ui`; the sidebar does not use it.
- **Ordering** (`sort_key`, the parent's order mode) is not built in either line, and stands as decided.
