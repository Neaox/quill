# Web review closure

**Date:** 2026-09-13
**Closes:** `docs/architecture/review-2026-09-13-web.md`
**Standard:** AGENTS.md rules 6, 12, 13, 14, 15, 16, 19; ADR-013 (frontend state), ADR-019 (design system), ADR-027 (block widths), ADR-028 and its amendment (theme versus layout), ADR-030 (highlighting), ADR-031 (render caching), ADR-035 (human-readable URLs); `docs/architecture/styling.md`, `docs/architecture/patterns.md`, `docs/design/feedback.md`, `docs/operations/bundle-budget.md`.
**Scope of the work:** `apps/web/**`, `packages/ui/**`, the `package.json` of `packages/{theme,ui,domain,brand,api-client,highlight}` and `@quill/theme`'s new `./builtin` entry, `e2e/**`, `scripts/check-bundle.ts`, the root `package.json`, `.github/workflows/ci.yml`, and `docs/operations/bundle-budget.md`. `apps/server`, `packages/application`, `packages/markdown` and `packages/editor` were not touched.

**Gate at the time of writing**

```
pnpm check                                      green, end to end:
  pnpm format:check                             clean
  pnpm lint                                     0 errors (the pre-existing
                                                no-await-in-loop warnings are unchanged)
  pnpm lint:deps                                no violations (852 modules)
  pnpm check:tailwind                           every CSS file uses Tailwind 4 spelling
  pnpm typecheck                                green across 14 projects + e2e
  pnpm test:coverage                            3444 tests, all passing;
                                                packages/** 100% statements,
                                                branches, functions, lines;
                                                apps/web above its 80% floor
  pnpm build                                    green
  pnpm check:bundle                             reading route 206.4 KB gz
                                                against a 250 KB budget — PASS,
                                                and now part of `pnpm check`
pnpm exec playwright test                       84 journeys across chromium,
                                                firefox, webkit and mobile-safari,
                                                all passing (run twice)
pnpm changelog:check                            valid
```

## Executive summary

Every finding is closed but one, and that one is a gap in the **server's** API
rather than in the web application: **L10**, the theme identity is still never
applied, because no M2 route carries a theme or a layout to apply. ADR-028's
amendment schedules both with the workspace settings work in M3; the one place
that will read them carries a `TODO(M3)` saying so, and the machinery it will
use is exactly what this pass moved behind `@quill/ui/theme`.

Three things changed that a reader can see, and that are worth naming before
the tables:

- **Every link in the chrome is a real navigation.** The revision timeline and
  the breadcrumb were plain anchors, so reading an older revision or stepping
  back to the workspace reloaded the whole application; under the default
  identity the header's trail was not a link at all. The design system now has
  one link seam and describes a destination as a route and its parameters
  rather than as a string somebody interpolated.
- **The reading route is 206.4 KB gzipped, down from 279.9 KB**, against a
  250 KB budget — and `check:bundle` is now part of `pnpm check` and blocks in
  CI.
- **Publish and restore report themselves.** Both are named in
  `docs/design/feedback.md` as promise-toast cases and had none; a publish that
  could not happen because somebody else published first now says so instead of
  settling in silence.

Two bugs were found by walking the running application that the review had not
named; both are fixed and both have a test. They are at the end, under
"Found in the walkthrough".

## Findings from the review

### Critical

| # | Verdict | Where it is proved |
|---|---|---|
| C1 | **PASS** | `RevisionTimeline` takes the same `linkComponent` seam `Tree` and `IconRail` had, and `RevisionPanel` passes the router's. `packages/ui/src/components/revision-timeline.test.tsx` "renders every tick through a supplied `linkComponent`, in both variants" and "describes a destination as a route and its parameters, never as a built href"; `apps/web/src/features/documents/document-page.test.tsx` "says which revision is on screen and offers the way back" |
| C2 | **PASS** | `Breadcrumb` takes the seam, `DocumentHeader` hands it to *both* variants, and the readout renders its non-final steps as links rather than dropping the destination. `packages/ui/src/components/breadcrumb.test.tsx` "renders every step through a supplied `linkComponent`"; `document-header.test.tsx` "links the readout ancestors, and leaves a step with no destination as text" and "hands its `linkComponent` to both variants"; `document-shell.test.tsx` "renders every link it owns — the rail and the header trail — through one `linkComponent`" |

### High

| # | Verdict | Where it is proved |
|---|---|---|
| H1 | **PASS** | Steps 1–4 of the plan are done; steps 5 and 6 were not needed. `pnpm check:bundle`: reading route **206.4 KB gz**, 43.6 KB inside its budget. The table is at the end of this document, and `docs/operations/bundle-budget.md` records what holds it there |
| H2 | **PASS** | No primitive takes an `href` any more: `LinkTarget` is `{ to, params, search, hash }` and the router interpolates and encodes it. `packages/ui/src/lib/link.test.tsx` (8 cases, including "encodes a parameter, so a slug can never escape its segment"); `apps/web/src/lib/routing/document-reference.test.ts` "describe a place as a route pattern and its parameters, never as a built URL" and "names a revision in the search params rather than in the path" |
| H3 | **PASS** | `scrollRestoration: true` in `createAppRouter`, which is now the router every test mounts too (`lib/api/render-app.tsx`). `scrollToTopSelectors` is deliberately unset and the router's doc comment says why: the shell's main column does not scroll a container of its own, and the three columns that do are precisely the ones that must keep their position |
| H4 | **PASS** | The complementary column is the slot, not a container inside it, and a column nothing has rendered into collapses (`.shell-aside:empty` in `components.css`). `packages/ui/src/components/document-shell.test.tsx` "renders the complementary column only when something asks for one" |
| H5 | **PASS** | The layout's loader resolves the segment once, seeds the workspace under its **id**, prefetches the tree by that id, and every component reads the same entry through `useLoadedWorkspace`; a rename writes both spellings. The stale comments are gone and `shortId` is required. `apps/web/src/app/router.test.tsx` "canonicalising a document address" (7 cases); `document-reference.test.ts`; `e2e/organise.spec.ts` "the rename survived the publish" |

### Medium

| # | Verdict | Where it is proved |
|---|---|---|
| M1 | **PASS** | `DocumentList` links by `documentReference()`, like every other surface. `apps/web/src/features/workspaces/document-list.test.tsx`; `e2e/organise.spec.ts` opens documents from the workspace home without a redirect |
| M2 | **PASS** | `useLoadedWorkspace` and `useLoadedDocument` are `useSuspenseQuery` over the same options factories the loaders await, and the unreachable pending branches are gone from `DocumentPage`, `WorkspaceLayout`, `WorkspaceHomePage` and `PresentRoute`. `document-page.test.tsx` (18 tests) and `workspace-home-page.test.tsx` still pass unchanged, which is the point: nothing a person can see moved |
| M3 | **PASS** | `toast.promise` wraps both, each with the one resolved action `docs/design/feedback.md` allows, and each holding its id so a retry replaces the toast rather than stacking one. `features/documents/revision-panel.tsx`, `features/documents/editor-route.tsx`; `editor-route.test.tsx` "opens the merge dialog"; `e2e/journey.spec.ts` publishes and restores |
| M4 | **PASS** | Both `params.parse` blocks are gone; a route cannot match an empty segment, so there was nothing to reject |
| M5 | **PASS** | `routes/__root.tsx` has an `errorComponent` rendering the route notice, so a route with none of its own no longer falls through to the router's raw error screen |
| M6 | **PASS** | One `Menu` in `packages/ui`, on Radix's `DropdownMenu`, used by the tree's rows, the tree's collections, the document header and the organisation page. `packages/ui/src/components/menu.test.tsx` (8 cases) proves the keyboard model the two hand-rolled versions claimed and never had: opening from the keyboard onto the first item, arrow keys, Escape returning focus to the trigger, a disabled item that does not swallow a press |
| M7 | **PASS** | One `RenameDialog` and one `ConfirmDeleteDialog` (`features/dialogs/`), used by collections, units and workspaces. `features/admin/organisation-page.test.tsx` and `e2e/organise.spec.ts` exercise all three of each |
| M8 | **PASS** | `ImageUrlDialog`: a labelled field in the product's own `Dialog`, with focus trapped and returned. `editor-route.test.tsx` "asks for an address in a labelled dialog rather than inserting a broken image" |
| M9 | **PASS** | The presentation route has a loader that asks for the document and the body together, and the component mounts the section on screen plus one either side (`MOUNTED_NEIGHBOURS`). `features/documents/present/present-route.test.tsx` (all 57 present tests pass unchanged) |
| M10 | **PASS** | `renderApp` mounts `createAppRouter` and `createQueryClient` — the application's own options, over a memory history — and the fixtures carry `shortId`. `app/router.test.tsx` "canonicalising a document address": the canonical address, a stale title slug, a bare key, an old UUID, a moved workspace, a workspace named by its id, and `replace` rather than `push` |
| M11 | **PASS** | One `AppPage` (`features/layout/app-page.tsx`) for the signed-in home and the organisation page: one bar, at `h-shell-header` — the workspace shell's own height, from the same token — with the theme control both pages were missing |

### Low

| # | Verdict | Where it is proved |
|---|---|---|
| L1 | **PASS** | `WorkspaceIconRail`, `useCollectionNames`, `WorkspaceTreeProps.documents` and the `full` slot in `routeNoticeStyles` are gone; `pnpm lint` has no unused exports left in those files |
| L2 | **PASS** | The document route uses `optionalStringSearch` from `routes/-search.ts`, like the four auth routes |
| L3 | **PASS** | `createQueryClient({ onUnauthorized })`. The mutable slot is now a local in the composition root (`app/app.tsx`), closed over by the handler. `lib/api/query-client.test.ts` "keeps one handler per client, so a second client cannot redirect the first one's router" |
| L4 | **PASS** | One declaration: `--spacing-shell-header` in `tokens.css`, with `--anchor-offset` derived from it. The sticky offsets, the prose scroll margin, the showcase's section offset and the contents' observer band all read it; `packages/ui/src/lib/metrics.test.ts` reads the stylesheet and fails if the two JavaScript constants stop agreeing with it |
| L5 | **PASS** | `aria-current:` (bare) in `revision-timeline.tsx`, `present-go-to.tsx` and `table-of-contents.tsx`; `pnpm check:tailwind` is green |
| L6 | **PASS** | The contents list is memoised on the outline the query answered with and the effect depends on the heading ids themselves; the revision is expressed as a `key` on the component, because a new revision is a new subscription *and* a new "which heading am I in". `features/documents/table-of-contents.tsx`; `document-page.test.tsx` "follows the reader down the page" |
| L7 | **PASS** | `workspaceReference` takes a required `slug` and returns it; there is no `??` left to produce `/w//d/…`, and the layout reads the workspace the loader resolved rather than the spelling in the address bar |
| L8 | **PASS** | The edit route's loader names the document, so the tab says `Editing <title>`; `apps/web/src/routes/_authenticated/w/$workspaceSlug/d/$documentId/edit.tsx` |
| L9 | **PASS** | `TODO(shell)` went with the dead prop; `TODO(seam)` is closed by moving `textLinkClassName` into `@quill/ui` at its third consumer (rule 12's rule of three). Every remaining `TODO(` names a milestone or an ADR, which `quill/tagged-todo` enforces |
| L10 | **OPEN** | No M2 route carries a theme or a layout, so there is nothing to apply. ADR-028's amendment settles the model (identity per organisation, layout per workspace) and schedules both with workspace settings in M3. `features/workspaces/workspace-layout.tsx` carries a `TODO(M3)` at the one place that will read them, and the machinery is a subpath (`@quill/ui/theme`) rather than dead weight in every reader's bundle |
| L11 | **PASS** | `textLinkClassName` is a `@quill/ui` primitive with a `size` variant; `route-notice.tsx`, `setup-card.tsx` and the four auth screens use it, and `apps/web/src/lib/forms/text-link.tsx` is gone. `packages/ui/src/components/text-link.test.tsx` |

## The link seam, in one place

`packages/ui/src/lib/link.tsx` declares one `LinkTarget` (`{ to, params,
search, hash }`), one `LinkComponent`, and one `PlainLink` that resolves a
target to an `href` for a consumer with no router. `IconRail`, `Tree`,
`Breadcrumb`, `RevisionTimeline`, `DocumentHeader` and `DocumentShell` all take
the same seam — one type rather than one per component, because there is one
seam — and the application supplies one adapter,
`apps/web/src/lib/routing/router-link.tsx`.

Two details of the router's own `Link` are pinned in that adapter, and the
reason is in its doc comment: `activeOptions: { exact: true }`, because the
router's default prefix match would force `aria-current="page"` onto a
breadcrumb ancestor that is not the page anybody is on; and `activeProps: {}`,
because the router otherwise appends an `active` class the variant definitions
never wrote and `tailwind-merge` never saw. `data-status="active"` still
arrives, which is the attribute-shaped version of the same fact.

`CommentsPanel` is the one primitive that still takes an `href`, deliberately:
its destination is a fragment inside the document being read, not a route, and
a plain anchor is the right element for that.

## Bundle

The plan's first four steps, measured one at a time on the post-review code:

| Step | Reading route (gz) | Δ |
| --- | --- | --- |
| Baseline (the review's figure, re-measured) | 279.9 KB | — |
| 1. `"sideEffects"` on `theme`, `ui`, `domain`, `brand`, `api-client`, `highlight` | 227.3 KB | −52.6 KB |
| 2–3. `@quill/theme/builtin` and `@quill/ui/theme` subpaths | 214.4 KB | −12.9 KB |
| 4. The toast host as its own chunk | 206.4 KB | −8.0 KB |

Final table, `node scripts/check-bundle.ts`:

| Route | Files | Raw | Gzip | Brotli | Budget | Status |
| --- | --- | --- | --- | --- | --- | --- |
| reading | 36 | 673.3 KB | **206.4 KB** | 181.3 KB | 250.0 KB | **PASS** |
| workspace home | 31 | 651.4 KB | 198.1 KB | 173.9 KB | — | INFO |
| editor | 23 | 1980.0 KB | 620.8 KB | 525.1 KB | — | INFO |
| presentation | 17 | 532.6 KB | 155.0 KB | 135.1 KB | — | INFO |
| organisation | 21 | 614.6 KB | 183.7 KB | 161.0 KB | — | INFO |

Steps 5 (dropping the popover behind the revision timeline's `menu` variant)
and 6 (per-component entry points for `@quill/ui`) were **not** taken: the
route cleared its budget with 43.6 KB to spare after step 4, and both cost
structure for size the product does not need yet. They stay costed in the
review and named in `docs/operations/bundle-budget.md` as the first places to
look if the number moves.

Two notes on how the saving was made, because both are properties of the module
graph rather than of a bundler's cleverness:

- `@quill/theme/builtin` exports the three theme documents and nothing else,
  and every module below it imports only types. The schema validator and the
  colour doctor are therefore *unreachable* from the design system, not merely
  shakeable. `packages/ui/src/theme/theme-variants.tsx` is the one runtime
  consumer.
- `sonner` is imported by exactly one module, `sonner-toaster.tsx`, which
  `Toaster` loads with a dynamic `import()`. `toast.ts` holds no toast library
  at all: it states what was asked for and hands it to a `ToastSink` the host
  installs (rule 19: a port with one adapter), holding the rare call that
  arrives first. The host is loaded **immediately**, not on the first toast, so
  its live region exists long before anything is announced into it — a live
  region inserted with its message already inside it is unreliable to announce,
  and the saving does not depend on deferring it that far.

## Found in the walkthrough

Two bugs the review had not named, found by driving the running application
through Playwright at 1440×900 and 390×844 (screenshots in the scratchpad):

1. **A phone had thousands of pixels of empty page below the document.** Below
   the medium breakpoint the navigation column is capped at thirteen rems and
   scrolls its own tree — but as a `static` grid item its scrollable overflow
   propagated to the viewport, so a workspace with a few hundred documents gave
   the page an 8,200-pixel scroll for 1,065 pixels of content. The columns are
   `position: relative` at those widths now, which makes each the containing
   block for its own overflow. `e2e/design.spec.ts` "a long tree scrolls inside
   its own column rather than lengthening the page".
2. **A forty-pixel gap under the header on a phone**, introduced by that fix:
   the columns carry `top: var(--spacing-shell-header)` for when they are
   sticky beside the header, and `relative` made that offset real. They reset
   `top: auto` at the widths where they stack. `e2e/design.spec.ts` "the shell
   becomes one column on a phone, in the same order" now asserts each column
   begins where the one above it ends.

One polish change came out of the same pass: a row's "more actions" control is
revealed on hover, on focus, and while its menu is open — the treatment a
collection's own "+" already had — because a hundred permanently drawn "⋯" is
noise down the side of a document. It stays in the DOM throughout, so the
keyboard reaches it whether or not a pointer ever has.

## Judged and left alone

- **The colour scheme cannot be changed on a phone.** `ThemeToggle` is
  `hidden sm:flex` in both shells. ADR-028 layer 3 makes the scheme the
  reader's, so this is a real gap — but the workspace shell's bar is forty
  pixels holding a switcher, a document's path and its controls, and the fix is
  a place to put it (an account menu) rather than one more control in the row.
  It belongs with the account surface, not with this review.
- **The workspace home's document list runs the full width of the main
  column.** It is not on the reading grid, which the reading view is. That is a
  design decision about what a workspace's front page is, not a defect, and
  `docs/design/home.md` is where it should be settled.
- **`CommentsPanel` still takes an `href`.** See "The link seam" above: its
  destination is a fragment, not a route.
