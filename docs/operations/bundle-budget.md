# Bundle budget

Rule 13 (`AGENTS.md`) says the initial web bundle stays within budget, and
`quill-plan.md` section 31 puts a number on it: the reading route
(`/w/:workspaceSlug/d/:documentId`) ships under **250 KB gzipped**, with the
editor loaded on demand. `scripts/check-bundle.ts` turns that sentence into a
gate.

## What it measures

The web app is one Vite entry (`apps/web/index.html` → `src/main.tsx`) with
a few routes split into their own chunks via `lazyRouteComponent` — the
editor, the presentation view, the design showcase, the revision diff view
(`apps/web/src/app/router.tsx`). The reading route's own page component is
not split out, so what a reader downloads before they see a document is the
entry chunk plus whatever it imports statically.

`check-bundle.ts` reads `apps/web/dist/.vite/manifest.json` (`build.manifest`
in `apps/web/vite.config.ts`) and, for each route in the script's `ROUTES`
table, walks the manifest from that route's entry through its **static**
`imports` only — never `dynamicImports`, since those are separate chunks a
reader of that route never has to fetch. Every JS and CSS file the walk
reaches is read from disk, gzipped with `node:zlib` at level 9 (the level
the plan's figure is stated in), and also measured with brotli for
comparison. The reading route's total gzip size is checked against its 250
KB budget; the editor and presentation routes print the same numbers as
informational rows because the plan states no byte figure for them.

## Running it

```bash
pnpm --filter @quill/web build   # or: node scripts/check-bundle.ts --build
node scripts/check-bundle.ts
```

The output is a table (route, file count, raw, gzip, brotli, budget,
status) followed by the five largest files in the reading route's graph, so
a regression is diagnosable without re-running a bundle analyzer.

## It blocks

`check:bundle` is the last step of `pnpm check`, immediately after
`pnpm build`, so it measures the `dist` that build just produced. CI runs
`pnpm check` and nothing else for this, so a reading route over 250 KB
gzipped fails the pull request like a failing test does.

## What keeps it under budget

The 2026-09-13 web review found the route at **279.9 KB gzipped** and costed
a reduction plan; the pass that followed landed its first four steps and left
the route at **206.4 KB**, with roughly 44 KB of headroom.

| Step | Reading route (gzip) |
| --- | --- |
| Before | 279.9 KB |
| 1. `"sideEffects"` declared on `theme`, `ui`, `domain`, `brand`, `api-client`, `highlight` | 227.3 KB |
| 2–3. `@quill/theme/builtin` and `@quill/ui/theme` subpaths | 214.4 KB |
| 4. The toast host loaded as its own chunk | 206.4 KB |

Four things hold that, and each will fail this gate if it is undone:

- **`sideEffects`.** Every workspace package declares it. `false` where the
  package is pure; `["**/*.css"]` on `@quill/ui`, whose stylesheet entry is a
  side effect by definition; `["./src/grammars.ts"]` on `@quill/highlight`,
  whose grammar registrations genuinely are one. Without the field a bundler
  must assume every module in a package matters and keeps all of them.
- **`@quill/theme/builtin`.** The theme package's main entry reaches the
  schema validator (Ajv) and the colour doctor (culori, apca-w3) — about
  82 KB gzipped that belongs to the theme editor. The design system's
  variants context imports the `./builtin` subpath instead, whose module graph
  is data only, so the tools are unreachable rather than merely shakeable.
- **`@quill/ui/theme`.** The identity machinery (`applyThemeId`, `THEME_IDS`,
  `themeIdVariants`) is a preview concern — the design showcase today, the
  theme editor later — so it is a subpath rather than part of the barrel.
  Re-exporting it from `packages/ui/src/index.ts` puts all three theme
  documents back into every reader's bundle.
- **The toast host.** `sonner` and the stack it draws live in
  `packages/ui/src/components/sonner-toaster.tsx`, which `Toaster` loads with
  a dynamic `import()`. `toast.ts` itself holds no toast library: it states
  what was asked for and hands it to a sink the host installs, holding the
  rare call that arrives first. Importing `sonner` anywhere else puts it back
  in the first-render graph.

## The 2026-10-17 pass

By 2026-10-17 the work landing since M2 — tables, code languages and
highlighting, details, emoji, draw.io, navigation blocks, link previews — had
taken the route from 208.6 KB to **257.2 KB gzipped** (224.8 KB brotli), over
budget. The pass that followed brought it to **219.8 KB gzipped** (190.9 KB
brotli), measured on the same tree while other work kept landing, so the
steps below are each step's own saving at the time it was taken:

| Step | Reading route (gzip) |
| --- | --- |
| Before | 257.2 KB |
| 1. Menus, dialogs and the history popover fetch their Radix machinery on demand | 247.6 KB |
| 2. Tooltips too, with the group timing in our own provider | 230.4 KB |
| 3. The body's colour, diagram and emoji enhancements in their own chunk | 224.3 KB |
| 4. Move, Delete and the sidebar's collection dialogs on demand | 222.3 KB |
| 5. The attachments dialog on demand | 219.8 KB |

What holds it, and what each would cost undone:

- **Overlays on demand** (`packages/ui/src/lib/on-demand.ts`). `Menu`,
  `MenuButton`, `Dialog`, `Tooltip` and the `menu` variant of
  `RevisionTimeline` render their closed state — a trigger announced exactly
  as the open-able one is (`aria-haspopup`, `aria-expanded`, `data-state`) —
  without Radix, and fetch the Radix half (`*-panels.tsx`) in idle time, or at
  once on hover, focus or a press. A press that lands first is held and the
  overlay opens when it arrives, a keyboard-opened menu onto its first item;
  a control that had focus when its replacement arrived gets it back. The
  styles and props live in `*-model.ts` so neither half imports the other.
  `TooltipProvider` is our own context (`createTooltipTiming`), not Radix's
  provider: the provider would bring the whole tooltip module, and with it
  Popper and floating-ui, back into every page that mounts one. About 28 KB
  gzipped. Importing `radix-ui` anywhere in the first-render graph undoes it.
- **Deferred body enhancements**
  (`apps/web/src/features/documents/deferred-enhancements.ts`). Code
  colours, diagrams, the diagram lightbox and animated emoji move nothing a
  reader is looking at, so they are a chunk of their own, asked for when the
  reading page's chunk is evaluated — in parallel with the body's request — and
  applied in the frame the body is drawn whenever they have arrived, which is
  normally. Code blocks' cards, tables' reading tools, details and the contents
  spy change the layout and stay with the body. About 6 KB.
- **Dialogs on demand.** Move, Delete, Attachments and the sidebar's
  collection dialogs are `onDemand` chunks fetched in idle time, and stay
  mounted once here, so they open and close as they always did. About 4.5 KB.
- **The on-demand list in `check-bundle.ts`.** The reading route's `onDemand`
  names every module above, the editor, the toast host, search and sharing;
  each must be a chunk of its own that the route's static graph never reaches,
  or the gate fails whatever the total. Add a module there when you move one
  out.

## Still to take

Costed on 2026-10-17 and left for the people working in those files:

- `document-reader.tsx` imports `NewDocumentDialog` statically for "new child
  page"; loading it with `onDemand`, as the sidebar now does, takes the form
  and its template questions out (about 2 KB).
- `lib/api/index.ts` is a barrel, and every module it re-exports lands in the
  entry chunk whoever uses it: the editor's draft and lock clients alone are
  0.6 KB there. Importing editor- and admin-only hooks from their own files,
  and dropping them from the barrel, takes out a few KB.
- `revision-panel.tsx` imports the restore dialog's form statically (about
  0.5 KB).
- The stylesheet is one file for every route, and it is now 35 KB of the
  total. `editor.css`, `table-editor.css` and `editor-menus.css` (about 2.7 KB
  gzipped on their own), `present.css` and `comparison.css` could be imported
  by the chunks that use them, and the utilities generated only for
  `packages/editor` (`@source` in `globals.css`) belong with the editor; that
  needs care with Tailwind's cascade order, which is why it is a step of its
  own.

## If it fails

Read the five largest files the script prints. If the regression is a package
that grew, check whether it belongs behind a subpath or a dynamic import
rather than raising the budget: the budget is `quill-plan.md` section 31's,
and changing it is a plan decision, not a build one. Step 5 of the review's
plan — the popover behind the revision timeline's menu variant — was taken by
the 2026-10-17 pass; step 6, per-component entry points for `@quill/ui`, is
still unspent, and "Still to take" above lists the rest.
