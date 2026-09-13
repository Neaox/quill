# ADR-019: Design system and component architecture

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 4, 14, and 29; ADR-027, ADR-028, ADR-030, ADR-033; research R13; design canvas `docs/design/canvas`

## Context

The product has to be polished, accessible, and recognisably itself, and it has to stay that way while three built-in identities and any number of tenant forks change its colour, its type, and several of its layouts (ADR-028). R13 chose the foundations — Radix Primitives behind an owned layer, self-hosted type, a two-layer token architecture — and built them with a hand-written palette in `tokens.css`. ADR-028 then made palettes generated, ADR-030 made syntax colours theme tokens, and `packages/theme` shipped the generator.

That left the design system one step behind its own theming model: a second, hand-written source of colour, a hard-coded type pairing, and none of the signature variants a theme is supposed to choose between. This ADR records how the design system is organised now that the theme package is the source of both.

## Decision

### 1. Generated palettes are the only source of colour

`pnpm --filter @quill/ui generate:tokens` runs `generateTheme` and `toCss` for every built-in theme and writes `packages/ui/src/styles/generated/<id>.gen.css`, plus `syntax-tokens.gen.css` from `@quill/highlight`'s `tokenCssContract()`. `tokens.css` imports those files and contains no colour of its own.

Generated output carries the repository's `.gen.` suffix, so the formatter and the coverage report leave it alone, and its first line names the command that rewrites it.

Each generated file is scoped to one identity, and exactly one ever applies:

```text
html                               Instrument, the default
html[data-theme-id="instrument"]   Instrument, named explicitly
html[data-theme-id="press"]        Press
html[data-theme-id="atelier"]      Atelier
```

The default's scope is `:root:where(:not([data-theme-id]), [data-theme-id='instrument'])`, so the absence of the attribute *is* the default identity, exactly as the absence of `data-theme` is "follow the operating system". Inside each scope the light, `prefers-color-scheme`, and explicit `data-theme` blocks resolve in the order R13 established.

**No hand-written colour anywhere.** Not in a component, not in a stylesheet, not as a Tailwind arbitrary value. A component names a semantic token (`bg-surface`, `text-muted`, `border-border`); the semantic layer in `tokens.css` maps those names onto `--palette-*`; the generated file supplies the value. A colour that is not in the generated palette is a design decision, and it belongs in the theme document or in the colour rules, not in a class list.

Two tests hold this together: one regenerates every file and compares it byte for byte with what is on disk, so a stale palette fails the build rather than shipping; the other checks that every `--palette-*` name the semantic layer references is emitted by every theme, so the two layers cannot drift apart. Because nothing else touches a `.gen.css` file, that comparison is the only thing keeping it honest, and it is exact.

### 2. Syntax colours are generated the same way

`syntax-tokens.css` is generated from the token classes `@quill/highlight` declares, as two selector families that are **never comma-joined** — `.tok-<class>` for markup and `::highlight(<prefix><class>)` for ranges — both reading the same `--token-<class>` the theme emits, both colour-only (ADR-030). A coverage test enumerates every class each registered grammar can emit, for every supported language, and fails if one lacks a variable in any theme or a rule in either family.

### 3. Type comes from the theme

`fonts.css` registers the curated set (ADR-028) as self-hosted latin and latin-ext `@font-face` rules with `font-display: swap`. It never selects a face: a theme's `--font-display`, `--font-sans`, `--font-reading`, and `--font-mono` do that. Prose reads `--font-reading` for its body and `--font-display` for its headings, so a document's structure is set in the identity's own voice — the same rule gives Instrument Plex Sans headings over a Plex Serif body, Press Newsreader over Newsreader, and Atelier Instrument Serif over Instrument Sans, with no per-theme rule.

The type scale, the reading measure, the vertical rhythm, control heights, motion, and the ADR-027 grid are layer 0: written once, never themable.

### 4. How state, variation, and theme are expressed

`docs/architecture/styling.md` is the rule; this is how the design system applies it.

**Interaction and accessibility state is an attribute.** `disabled`, `aria-busy`, `aria-invalid`, `aria-current`, `aria-selected`, Radix's `data-state`, and a native radio's `checked` are what assistive technology reads, so they are also what the style follows: `disabled:opacity-50`, `aria-busy:cursor-progress`, `aria-invalid:border-danger`, `aria-[current=page]:shadow-[inset_2px_0_0_var(--color-accent)]`, `data-[state=active]:border-accent`, `peer-checked:text-foreground`. No JavaScript branch in this package decides a colour for a state, so a component cannot look selected while announcing that it is not.

**Design variation is `tailwind-variants`.** Every component declares its variants with the configured `tv` exported from `packages/ui/src/lib/class-names.ts`, using `slots` for the multi-part ones (dialog, callout, input, tabs, tree, timeline, the shell). `cx` is `tailwind-variants`' merge, extended once for the design system's own utilities — `text-2xs`, `text-reading`, `font-display`, `font-reading`, `tracking-caps`, the three shadows, the three easings — because a merge that does not know a scale silently keeps both classes and lets stylesheet order decide.

**Theme axes are custom variants, not props.** `theme-instrument:`, `theme-press:`, `theme-atelier:`, `rules-hairline:`, `rules-double:`, and `rules-cards:` are declared once in `tokens.css` and read the data attributes the theme already sets (`data-theme-id` on the document element, `data-rules` on the shell and the prose article). Density is not a variant at all: the theme's `--density-scale` drives Tailwind's `--spacing`, so one declaration tightens every spacing and size utility in the product at once and no component carries a density class. The reading surface's own rule treatment stays in `prose.css`, on real elements, because server-rendered HTML arrives with no classes.

The signature components still take an explicit `variant` prop, which is the one place this differs from "never takes the theme as a prop": `readout` versus `breadcrumb` and `timeline` versus `menu` are different markup and different keyboard behaviour, not different paint, and a preview has to be able to render a variant the surrounding page is not in. The value defaults from the identity in scope, so a feature never passes one.

### 5. Two kinds of component

**Primitives** are the vocabulary: button, input, badge, callout, breadcrumb, tabs, dialog, tooltip, spinner, icons, code block, data table, scroll group, the layout grid, and the reading surface. They take props, not classes, and they are the only place a control's shape is written.

**Signature components** implement the bounded set of variants a theme chooses between (ADR-028, layer 1). Each is a real component with tests, which is what keeps the set bounded on purpose:

| Variant | Component | Built |
| --- | --- | --- |
| `header: readout \| breadcrumb` | `DocumentHeader` | both |
| `history: timeline \| menu` | `RevisionTimeline` | both |
| `navigation: tree \| tabs` | `Tree` | `tree`; `tabs` renders the tree and marks itself `data-navigation="tabs"` |
| `comments: panel \| sidenotes` | `CommentsPanel` | `panel`; `sidenotes` renders the panel and marks itself `data-comments="sidenotes"` |
| `rules: hairline \| double \| cards` | `data-rules` on the shell and the prose article | all three |

`DocumentShell` composes them into the frame every document is read in: banner, the rail's navigation, the tree's navigation, main, and the complementary column, in that order in the DOM at every width, so the tab sequence and the visual order agree whether it is four columns or one.

A component reads the variant from the identity in scope through `ThemeVariantsProvider`, and also takes an explicit `variant` prop, because a preview — the theme editor, the design showcase — has to be able to show a variant the surrounding page is not in. The unbuilt variants are honest rather than silent: they render the built alternative, carry a data attribute saying which variant was asked for, and each has a TODO test that says what it should assert once the real variant exists.

### 6. The accent is the only signal colour

It appears on the current revision tick, the current item in navigation, the current publication state, the primary action, and the focus ring. Nowhere else. Body links are ink with a quiet underline that takes the accent on hover; callouts are a rule down the leading edge rather than a tinted box; status is always a word as well as a colour. That discipline, not a brighter accent, is what makes the accent mean something.

### 7. Metadata is set in the mono face

Anything that is a fact *about* a document rather than part of one — a path, a version, an owner, a column heading, a line reference, a badge, a specimen label — is monospace, small, and quiet. It is one rule (`.meta`, `.meta-value`) rather than a habit, and it is most of what makes Instrument look like an instrument.

### 8. File layout

```text
packages/ui/
  scripts/generate-tokens.ts        writes the generated stylesheets
  src/styles/
    generated/<theme id>.gen.css    generated: one identity's palettes
    generated/syntax-tokens.gen.css generated: the token class rules
    generated-css.ts                the arrangement both the script and the drift test use
    fonts.css                       the curated set, registered once
    tokens.css                      the semantic layer, the scales, motion, base
    layout.css                      the ADR-027 named-line grid
    prose.css                       the reading surface
    components.css                  the structure behind the signature components
  src/components/                   primitives and signature components, one file each
  src/theme/                        the identity attribute, the scheme preference, the variant context
apps/web/src/features/design/       the showcase, composed from the above
```

`components.css` sits in Tailwind's `components` layer, so a class there is a default and a utility on the element always wins. A rule earns its place there when it is structural, when a parent attribute selects it, or when more than one component shares the shape; everything else stays in the component's own class list.

### 9. Features compose primitives and never restyle them

A feature imports `Button`, `Tree`, `DocumentShell`; it passes props. It does not pass a `className` that fights a component's own classes, does not write a colour, and does not copy a component's markup to change one thing. `cx` is deliberately not a Tailwind-aware merge, so a class that fights the base list has undefined behaviour rather than a quiet win — the supported way to change a component is a variant, and adding one is a design decision made in the design system.

If a feature needs something the system does not have, the change goes into `packages/ui` with its tests and its specimen on `/design`, where the next feature will find it.

### 10. The reading grid collapses on its container, not on the window

`.layout-grid` is its own `inline-size` container, and the ADR-027 thresholds are `@container` queries rather than media queries. What decides whether `wide` and `full` are distinct is the room left beside the rail, the tree, and a comments panel — not how big the window is — so a document in a preview pane collapses correctly on a wide screen, and one stylesheet is right in the reader, the editor, an export, and a side-by-side diff. `.shell-main` and `.page-main` are named containers (`main`) so a feature can adapt to the space it was given with `@sm/main:` and `@md/main:`.

Viewport breakpoints are kept for the page shell alone — the rail turning on its side, the tree and the complementary column stacking — because there the question really is how big the window is.

### 11. The showcase is the system in use

`/design` is built out of `DocumentShell` and the real components carrying real props, not a picture of them, with an identity switcher beside the scheme toggle. Every primitive appears in every state, and every signature variant appears in both of its forms with the one the current identity has chosen marked as such. The contrast table is computed by the same generator that produced the palette, so it cannot go stale.

## Alternatives considered

- **Keeping the hand-written palette and generating only new themes.** Rejected: two sources of colour is how a design system drifts, and the hand-written one would have been the one people edited.
- **A CSS-in-JS or a runtime style object for themes.** Rejected: ADR-028 requires a theme change to be a palette swap with no rebuild and no reflow, which `@theme inline` plus custom properties already gives with no runtime at all.
- **Making the signature variants CSS-only, selected by a data attribute.** Rejected for the structural ones: sidenotes versus a panel and a timeline versus a menu are different markup and different keyboard behaviour, not different paint. Kept for `rules`, which genuinely is paint, and which therefore also reaches server-rendered HTML with no classes of its own.
- **Shipping the unbuilt variants as empty or as errors.** Rejected: a tenant on Press should get a complete, correct page today. Rendering the built alternative with a data attribute and a TODO test keeps the page right and the gap visible.
- **A generic `styled` escape hatch on every primitive.** Rejected: it is the mechanism by which a design system becomes a suggestion.
- **Conditional class strings for state (`isCurrent ? 'bg-accent' : ''`).** Rejected: it lets a component look selected while announcing that it is not, and it puts the same fact in two places.
- **Media queries for the reading grid.** Rejected once the shell existed: at 1440 pixels the main region beside a rail, a tree, and a comments panel is 55rem, so `wide` and `full` are genuinely the same width there. A media query said otherwise and was wrong.
- **Density as a class on every component, or a `compact:` variant.** Rejected: the theme already emits `--density-scale`, and Tailwind 4 derives every spacing and size utility from `--spacing`, so the two meet in one declaration.
- **Generating the palettes at build time in the Vite pipeline instead of committing them.** Considered. Committed files are reviewable in a diff, work for server rendering and HTML export without a bundler, and make a palette change visible in a pull request; the drift test removes the only real objection.

## Consequences

- A theme change is a change to a theme document plus `pnpm --filter @quill/ui generate:tokens`. Nothing else moves.
- Adding a language to `@quill/highlight` fails the build until its classes are themed, which is the point.
- Adding a signature variant is a deliberate act: a component, its tests, a specimen, and an entry in ADR-028's bounded set.
- `packages/ui` depends on `@quill/theme` and `@quill/highlight`. Both are source packages in the workspace, so a browser bundle that imports the design system also reaches the theme generator; `/design` uses it for the contrast table, and a route-level split is the fix if a feature bundle ever should not.
- The two unbuilt variants, `navigation: tabs` and `comments: sidenotes`, are the outstanding work this ADR names. Until they exist, Atelier and Press are correct but not yet complete.
- `packages/ui` depends on `tailwind-variants`, and the design system's merge configuration is the one thing a feature must import rather than re-declare: `tv` is exported already configured.
- Because `--spacing` carries the density, a length written as an arbitrary value (`w-[68px]`) opts out of it silently. `pnpm check:tailwind` refuses those, which is the mechanism that keeps the density real.
