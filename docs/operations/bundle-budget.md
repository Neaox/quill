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

## If it fails

Read the five largest files the script prints. If the regression is a package
that grew, check whether it belongs behind a subpath or a dynamic import
rather than raising the budget: the budget is `quill-plan.md` section 31's,
and changing it is a plan decision, not a build one. Steps 5 and 6 of the
review's plan — dropping the popover behind the revision timeline's menu
variant, and per-component entry points for `@quill/ui` — are costed and
unspent, and are where to look before the number moves.
