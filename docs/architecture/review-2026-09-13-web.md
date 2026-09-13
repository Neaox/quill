# Web application review

- **Date:** 2026-09-13
- **Scope:** `apps/web` (routes, app, features, lib, styles), its composition of `packages/ui` and `packages/editor`, and the bundle. Read-only; router usage checked against the TanStack Router docs for the installed version.
- **Method:** rubric in priority order: routing and layout composition; state (ADR-013); DRY and composition; idiom (React 19, TanStack Query, tailwind-variants); the feedback rules; accessibility; performance; test quality.
- **Outcome:** two critical, five high, eleven medium, eleven low findings, a costed bundle-reduction plan, and a "what is solid" record. Closure is recorded in `review-2026-09-13-web-closure.md`.

## Critical

**C1. Revision timeline links are plain anchors.** `packages/ui/src/components/revision-timeline.tsx:73-77` renders `<a href>` with no link seam; the reading view feeds it in-app URLs. On the default identity (Instrument, timeline in the aside) clicking a revision performs a full page load: the SPA restarts, the query cache is discarded, sidebar scroll is lost. Fix: the same `linkComponent` prop `IconRail` and `Tree` already have, passed from the revision panel.

**C2. The breadcrumb is a plain anchor**, with the same consequence on Press and Atelier (`breadcrumb.tsx:62`, used by the `breadcrumb` header variant). Under Instrument the readout variant silently discards the href. Fix: the same seam threaded through `DocumentHeader` and `DocumentShell`; the readout renders non-final steps as links or stops computing a dead href.

## High

**H1. The reading route is over budget because of the theme barrel.** `packages/ui/src/theme/theme-id.ts` imports built-in theme values from `@quill/theme`'s barrel, which statically imports the schema validator (Ajv + formats, 44.9 KB gz) and the colour doctor (culori, apca-w3, 37.5 KB gz). No workspace package declares `sideEffects`. Only the design showcase uses the theme-id machinery. See the reduction plan.

**H2. Path params interpolated into `to`.** `workspace-navigation.tsx:77-87` and `revision-panel.tsx:91` build strings and pass them as `to`, which the router docs forbid: no type-safe routing, no param encoding, and a search param inside a path string. Fix: nodes carry `{ to, params }` (or a link node the feature supplies); primitives stay router-agnostic.

**H3. Scroll restoration is off.** Nothing sets `scrollRestoration`; a new document opens at the previous scroll offset and back-navigation restores nothing. Fix: `scrollRestoration: true` in the router.

**H4. The editor route renders an empty aside column.** The layout passes the aside container whenever a document id is present; only the document page fills it. Fix: render the aside only when the slot has content.

**H5. Stale comments and mixed workspace addressing.** Comments in `lib/api/workspaces.ts` and the workspace route claim there is no slug lookup (there is); `document-reference.ts` treats `shortId` as optional (it is required). The single-workspace redirect and the switcher use the UUID while home, admin, and dialogs use the slug, producing two cache entries for one workspace, a rename that leaves the header stale, and a tree prefetch under a key nobody reads. Fix: every workspace address through `workspaceReference()`; invalidate both spellings or resolve the slug in the loader; delete the stale comments and fallback.

## Medium

- **M1.** The workspace home links documents by UUID, so every click canonicalises through a redirect. Use `documentReference()`.
- **M2.** Routed components use `useQuery` and hand-roll unreachable pending branches for data the loader already guaranteed. Use `useSuspenseQuery` for loader-awaited data.
- **M3.** Publish and restore have no promise toast, though the feedback guide names them. Wrap the mutations in `toast.promise` with the resolved action.
- **M4.** `params.parse` throws to reject an empty segment the router cannot produce. Delete both blocks.
- **M5.** No root `errorComponent`; most routes fall back to the router's raw error screen. Add one rendering the route notice.
- **M6.** The overflow menu exists twice (`tree.tsx` and `overflow-menu.tsx`) and neither implements the menu keyboard model it claims. One `Menu` primitive in `packages/ui` on the Radix dropdown.
- **M7.** Three near-identical rename dialogs and three delete-once-empty dialogs across collections, units, and workspaces. One `RenameDialog` and one `ConfirmDeleteDialog`.
- **M8.** Image insertion uses `window.prompt`. A labelled dialog, or at minimum a tagged TODO.
- **M9.** Presentation has no loader (spinner then a client waterfall) and mounts every step at once, each parsing and highlighting. A loader for the document and body; mount the current step plus one neighbour.
- **M10.** Test gaps: the ADR-035 canonicalisation loader has no test and fixtures omit `shortId`; `renderApp` builds its own router, so the app's router options and query client are exercised by nothing.
- **M11.** Home and admin pages duplicate page chrome, cannot change theme, and use a different header height from the shell. One `AppPage` shell for non-workspace signed-in surfaces.

## Low

- **L1.** Dead code: `WorkspaceIconRail`, `useCollectionNames`, the unread `documents` prop, an unused `full` slot.
- **L2.** `optionalString` duplicated in the document route.
- **L3.** Module-level mutable unauthorised-handler; make it per query client.
- **L4.** Four different numbers for one header height across CSS, scroll margin, observer root margin, and a specimen class.
- **L5.** `aria-[current=true]:` where the bare `aria-current:` variant applies.
- **L6.** A string-encoded effect dependency in the table of contents.
- **L7.** A `??` fallback that lets an empty workspace slug produce `/w//d/…`.
- **L8.** The edit route's head title is the literal "Editing".
- **L9.** `TODO(shell)` and `TODO(seam)` tags name no milestone, ADR, or issue.
- **L10.** The theme identity is never applied in the app; every workspace renders Instrument's variants.
- **L11.** A hand-written inline link class list where a shared primitive exists.

## Bundle reduction plan

Baseline: reading route 279.9 KB gz across 18 files against a 250 KB budget; the UI chunk is 137.5 KB gz and the entry 100.8 KB gz.

| Step | Saving (gz) | Running total |
| --- | --- | --- |
| 1. `"sideEffects": false` on `packages/theme` (and ui, domain, brand, api-client, highlight) | about 82 KB | about 198 KB |
| 2. A `./builtin` subpath export on `@quill/theme`; `theme-id.ts` imports from it, so the browser can never reach the validator or the doctor | guarantees step 1 | about 198 KB |
| 3. Move theme-id machinery to `@quill/ui/theme`, imported only by the showcase | 3 to 5 KB | about 194 KB |
| 4. Lazy-mount the toaster on first use | 10 to 14 KB | about 181 KB |
| 5. Drop or lazy-load the popover behind the timeline's menu variant | 4 to 8 KB | about 175 KB |
| 6. Per-component entry points for `@quill/ui` | 5 to 10 KB | about 165 KB |

Steps 1 and 2 clear the budget with headroom at no runtime cost. The tokenizer is already absent from the reading route. The editor route (692.7 KB gz) is correctly isolated and lazy.

## What is solid

The route tree is well shaped: a real pathless authenticated layout with the single auth check, a real workspace layout with the shell inside it and an outlet, presentation opting out with the documented suffix, a generated and committed route tree, no manual lazy components. Preload on intent with a zero preload stale time is exactly the documented pairing for a Query-owned cache. Loaders and components share the same query-options factories; the layout awaits the workspace but only prefetches the tree, deliberately. The document route's not-found renders inside main with the shell intact, and the test pins node identity of the shell across navigation. The slot portal mechanism commits both sides together. Every effect synchronises with a named external system and carries its reason; no state is used as a command bus. Query keys are centralised and invalidation is careful, including identical-object 304 revalidation. Tailwind-variants usage is disciplined and states are attribute-driven. Accessibility is real: ordered landmarks with a skip link, `aria-current` carrying announcement and paint, alerts on form errors, a live region for presentation steps, `time` elements, id-backed labels. The comments explain why, almost everywhere.
