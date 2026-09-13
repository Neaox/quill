# R13 — Frontend architecture and design system

**Question.** What do we build the interface out of? Specifically: which accessible primitive library do we own a thin layer over, what type system carries long-form technical reading, and how are the design tokens, themes, and the ADR-027 layout grid expressed so that the reader, the editor, server-rendered public pages, and HTML export all look the same?

**Time box.** Alongside milestone M0. If it expires without an answer, the fallback is a system font stack with hand-rolled primitives, which we would pay for in accessibility defects rather than in time.

## What was examined

Versions are the ones published on npm on 2026-09-12.

| Thing                       | Version           | Licence    | Notes                                                    |
| --------------------------- | ----------------- | ---------- | -------------------------------------------------------- |
| `radix-ui`                  | 1.6.7             | MIT        | Unified entry point for Radix Primitives                 |
| `@base-ui-components/react` | 1.0.0-rc.0        | MIT        | Base UI, from the MUI team                               |
| `react-aria-components`     | 1.21.1            | Apache-2.0 | Adobe React Spectrum                                     |
| `@fontsource-variable/inter`| 5.3.0             | OFL-1.1    | Inter, variable weight axis                              |
| `@fontsource-variable/source-serif-4` | 5.3.0   | OFL-1.1    | Source Serif 4, variable weight axis                     |
| `@fontsource-variable/jetbrains-mono` | 5.3.0   | OFL-1.1    | JetBrains Mono, variable weight axis                     |
| Tailwind CSS                | 4.3.3             | MIT        | `@theme`, `@theme inline`, `@custom-variant`, `@source`  |
| axe-core                    | 4.13.0            | MPL-2.0    | Development dependency only; never shipped               |

The recommendations were implemented rather than prototyped: `packages/ui` and the `/design` route in `apps/web` are the spike, and they are production code.

## Findings

### 1. Accessible primitives

**Release history matters more than feature lists here.** A primitive layer is a twenty-year decision for a documentation platform, so the question is not only "is it good today".

| | Radix Primitives | Base UI | React Aria Components |
| --- | --- | --- | --- |
| Latest release | `radix-ui@1.6.7`, 2026-07-24, with 1.7.0 release candidates through 2026-07-31 | `1.0.0-rc.0`, **2025-12-04** — no publish in nine months, still pre-1.0 after fourteen releases | `1.21.1`, 2026-09-04, plus nightly builds every weekday |
| Licence | MIT — identical to this repository | MIT | Apache-2.0 — permissive and compatible, but a second licence and a patent grant to track |
| Unstyled | Yes. Renders semantic DOM with `data-*` state attributes; no class names, no CSS shipped | Yes | Yes, but the API is render-prop-shaped (`className` as a function of state), which is a different authoring model from Tailwind class strings |
| Install weight (unpacked) | 106 KB for the façade; individual packages ~100 KB each including source maps and both module formats | 4.3 MB | 6.6 MB, and the `@react-aria`/`@react-stately` graph plus per-locale message bundles come with it |
| SSR | Ids come from React 19 `useId`; nothing measures layout until an overlay opens, so first paint is stable | Same approach | Works, but historically needed an `SSRProvider` and carries more client-side machinery |
| Accessibility depth | Strong on the components we need now (dialog, tooltip, tabs, dropdown). Thinner on collections and internationalised text handling | Strong | Best in class: tested across screen readers on desktop and mobile, with real touch and internationalisation work behind it |

The accessibility gap between the three is smaller than it used to be for *these* components. It widens for collection components — combo box, select, list box, command palette — where React Aria's collection and selection models are still the most complete implementation available.

### 2. Typography

A system font stack costs nothing to download and is inconsistent everywhere: metrics, weight availability, and x-height differ per platform, so a vertical rhythm tuned on one operating system is wrong on the next, and "beautiful by default" (plan section 4) is not achievable. Against that, self-hosted fonts cost bytes and must be bundled locally, because a runtime CDN would leak every reader of a self-hosted installation to a third party.

Measured sizes of the latin subsets actually shipped (already woff2-compressed, so these are transfer sizes):

| Face | Subset | Size |
| --- | --- | --- |
| Inter Variable, normal | latin | 48.3 KB |
| Inter Variable, normal | latin-ext | 85.1 KB |
| Source Serif 4 Variable, normal | latin | 50.8 KB |
| Source Serif 4 Variable, italic | latin | 51.5 KB |
| Source Serif 4 Variable, normal | latin-ext | 42.0 KB |
| JetBrains Mono Variable, normal | latin | 40.4 KB |

An English page downloads the three latin faces it uses: **139.5 KB** for interface text plus reading body, or 191 KB once an italic appears. Each face is gated by `unicode-range`, so latin-ext costs nothing until a reader opens a document containing extended-Latin characters. All three families are SIL Open Font Licence 1.1, which is compatible with the MIT licence of this repository; the notices are recorded in `packages/ui/FONT-LICENCES.md`.

Measured in the browser at the shipped settings: the reading column is 608 px (38 rem) wide, body text is 17 px Source Serif 4 with a 28.9 px line box, giving **67 characters a line** — inside the 65–75 band.

### 3. Tokens and theming

Tailwind 4's `@theme` bakes values in at build time, which is wrong for a runtime theme switch. `@theme inline` does not: it emits `var(--palette-…)` into every utility, so one compiled stylesheet resolves to whichever palette is in scope. That makes a theme switch a change of one attribute on `<html>` — no recompilation, no second stylesheet, no reflow.

Three theme states are needed, not two: light, dark, and *follow the operating system*. Representing "system" as the **absence** of `data-theme` is what makes it work without JavaScript: the `prefers-color-scheme` rules stay in charge and a change to the system setting is picked up with no listener and no re-render.

**A namespace collision found the hard way.** Layout measurements were first written as `--width-content`, `--width-wide`, and `--width-full` inside `@theme`. Tailwind treats `--width-*` as the namespace behind its `w-*` utilities, so `--width-full: 84rem` silently redefined `w-full` from `width: 100%` to `width: 84rem`. Every `w-full` input on the page was 1344 px wide and clipped by its container. It was invisible in tests and only showed up when element geometry was measured in a real browser. Layout measurements are now plain `--layout-*` custom properties outside `@theme`.

#### Measured contrast (WCAG 2.2 AA: 4.5:1 for body text, 3:1 for control boundaries)

Computed from the OKLCH values in `tokens.css`, converted to sRGB and clamped, so these are worst-case ratios; on a wide-gamut display the accent and status colours are more saturated, not less contrasty.

| Pair | Light | Dark |
| --- | --- | --- |
| `foreground` on `background` | 15.99 | 16.39 |
| `foreground` on `surface` | 15.18 | 15.14 |
| `foreground` on `surface-raised` | 16.46 | 13.83 |
| `foreground` on `code-background` | 14.87 | 14.60 |
| `foreground` on `accent-subtle` | 14.65 | 13.07 |
| `foreground` on `success-subtle` | 14.81 | 13.20 |
| `foreground` on `warning-subtle` | 14.84 | 13.07 |
| `foreground` on `danger-subtle` | 14.77 | 13.35 |
| `muted` on `background` | 6.35 | 7.93 |
| `muted` on `surface` | 6.03 | 7.33 |
| `muted` on `code-background` | 5.91 | 7.06 |
| `accent` on `background` | 5.80 | 7.55 |
| `accent` on `surface` | 5.50 | 6.98 |
| `accent` on `accent-subtle` | 5.31 | 6.02 |
| `accent-foreground` on `accent` | 5.88 | 7.56 |
| `accent-foreground` on `danger` | 6.57 | 7.15 |
| `success` on `background` | 6.84 | 9.37 |
| `success` on `success-subtle` | 6.34 | 7.55 |
| `warning` on `background` | 6.77 | 10.05 |
| `warning` on `warning-subtle` | 6.29 | 8.02 |
| `danger` on `background` | 6.47 | 7.14 |
| `danger` on `danger-subtle` | 5.98 | 5.82 |
| `border-strong` on `background` (non-text, needs 3:1) | 3.40 | 3.91 |
| `border-strong` on `surface` (non-text, needs 3:1) | 3.23 | 3.61 |

The lowest text ratio in the system is 5.31:1, and the lowest boundary ratio is 3.23:1. Both clear AA with headroom; several pairs clear AAA (7:1) as well. The focus ring is the accent colour, so it inherits the 5.80:1 / 7.55:1 row and satisfies SC 1.4.11 against every surface it appears on.

Contrast is verified numerically rather than by axe, because jsdom does not do layout or resolve custom properties, so `color-contrast` cannot run there. axe runs on every primitive for everything it *can* check: names, roles, relationships, and structure.

### 4. The layout grid (ADR-027)

The named-line grid works exactly as the ADR describes, and CSS does most of the work: any `*-start`/`*-end` line pair creates an implicit named area, so a block asks for its width by name — `grid-column: content | wide | full` — with no negative margins anywhere.

Measured on the `/design` page:

| Viewport | `content` | `wide` | `full` | Sideways overflow |
| --- | --- | --- | --- | --- |
| 1440 px | 608 px | 928 px | 1214 px | none |
| 1024 px | 608 px | clamped to the main region | main region | none |
| 800 px | 608 px | 798 px (= `full`) | 798 px | none |
| 390 px | 308 px | 308 px | 308 px | none |

Below the medium breakpoint the three collapse to one column; between medium and large, `wide` and `full` are both the main region; at large and above the three are distinct. Sidebars are columns of `.page-shell`, outside the grid, so a `full` block cannot collide with the table of contents.

## Options

| Option | Strengths | Weaknesses | Rewrite risk if wrong |
| ------ | --------- | ---------- | --------------------- |
| **Radix Primitives, owned thin layer** | Stable 1.x, actively released; MIT matches the repo exactly; smallest install; genuinely unstyled, so Tailwind classes are the whole styling story; dialog, tooltip, and tabs are its most battle-tested components | Thinner on collection components; no built-in internationalised text handling | Low. The layer is ours: swapping one component's internals touches one file, because features import `Dialog`, not `Radix.Dialog` |
| **Base UI** | Same unstyled philosophy; well-designed API; MUI team behind it | Still `1.0.0-rc.0` with **no release in nine months**. Adopting a stalled release candidate as the foundation of a platform at M0 is a bet on a roadmap we cannot see | High. A pre-1.0 API can change under us, and a stalled one can be abandoned |
| **React Aria Components** | The best accessibility and internationalisation work in the ecosystem; extremely active; the strongest collection and selection model | Apache-2.0 rather than MIT; much larger dependency graph; render-prop styling model sits awkwardly beside Tailwind class strings; more component than primitive | Low-to-medium, and mostly in the other direction: it is the library we would *add* for a component Radix does not do well |
| **System font stack only** | Zero bytes; zero licence questions | Metrics differ per platform, so vertical rhythm and measure cannot be tuned once; "beautiful by default" is not reachable | Low to reverse, but it undercuts a stated product principle from day one |
| **shadcn/ui copy-paste set** | Fast to start; large component catalogue | Imports a whole opinionated design language along with the code, and the vocabulary is not ours. The instruction for this work was a small, owned primitive layer | Medium: unpicking someone else's conventions later is more work than writing ten components |

## Recommendation

**1. Radix Primitives (`radix-ui@1.6.7`), behind a thin layer we own.** It is the only one of the three that is simultaneously stable, actively released, MIT, genuinely unstyled, and small. Base UI is rejected on release history alone: a foundation layer cannot be a release candidate that has not shipped in nine months. React Aria is the better library on pure accessibility and internationalisation, and we are giving that up knowingly — see the trade-off below.

The layer is the point. Features import `Button`, `Dialog`, and `Tabs` from `@quill/ui`; they never see Radix. Three of the eleven primitives (dialog, tooltip, tabs) delegate to Radix for focus trapping, roving tab index, and floating positioning; the other eight are ours outright. Replacing Radix for one component is a single-file change.

**What would change this:** Base UI reaching a stable 1.0 with a sustained release cadence, or our first collection component (command palette, combo box) proving hard enough that React Aria's collection model is worth the second library. Mixing is allowed: the owned layer is exactly what makes it cheap.

**2. Three self-hosted variable families: Inter for the interface, Source Serif 4 for reading, JetBrains Mono for code.** A serif reading column with a sans interface is the clearest hierarchy available for long-form technical documentation: a reader can tell at a glance what is document and what is chrome. Headings inside prose are sans, which sharpens the document's own structure against its body text.

One modular scale, ratio 1.2, anchored at 1 rem, covers everything; the reading size (17 px) sits deliberately between `base` and `lg`, and prose heading sizes are `em` of the prose root, so changing one token rescales a document proportionally. The reading measure is 38 rem, measured at 67 characters a line.

**What would change this:** the reading face is a single token, `--font-reading`. If a serif body proves unpopular, changing that one line moves the whole reading surface to Inter with no other edit.

**3. A two-layer token architecture: a raw `--palette-*` layer per theme, and a semantic layer declared with `@theme inline`.** Components name semantic tokens and never see a value. Themes resolve `:root` → `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme='light'])` → `:root[data-theme='dark']` → `:root[data-theme='light']`, so the operating system preference is the default and an explicit choice always wins in both directions. "Follow the system" is the absence of the attribute.

Motion is handled once, not per component: `prefers-reduced-motion: reduce` collapses every duration token to 1 ms, so a new component cannot forget to opt in, and Tailwind's `--default-transition-duration` is wired to a token so a bare `transition-colors` is already on-system.

## Consequences

**Makes easier**

- One stylesheet serves the single-page app, server-rendered public pages, and HTML export, because the grid and the reading typography are plain CSS on plain elements. Rendered Markdown needs no classes.
- A theme switch is one attribute. Measured on `/design`: the `<h1>` bounding box is byte-identical before and after switching, and the e2e test asserts it.
- Accessibility is checkable in CI. Every primitive has an axe assertion and behavioural tests for keyboard operation; `packages/ui` is at 100% statement, branch, function, and line coverage.
- Adding a component is cheap and consistent, because spacing, colour, radius, elevation, and motion are all named.

**Makes harder, and the trade-offs taken**

- **Screen-reader coverage is now our job, not a vendor's.** React Aria would have given us better VoiceOver-on-iOS and internationalised text behaviour for free. Radix plus axe plus behavioural tests catches structural defects, not every announcement defect. Manual screen-reader passes belong in the definition of done for interactive surfaces, and R13 does not remove that obligation.
- **Fonts cost 139.5 KB on first load** for an English reader. That is a real cost against the "document open, cold, under 1 s" budget, accepted because `font-display: swap` means text is readable immediately and the faces are cached for every subsequent document.
- **`cx` is not a Tailwind-aware merge.** Passing `className="hidden"` to a component whose base list contains `inline-flex` produces undefined behaviour — source order in the compiled stylesheet decides, not the order in the attribute. This bit once during this work. The rule is that a primitive's variants are the supported way to change it; `className` is for layout and spacing, not for fighting the base styles.
- **Three families rather than two** is a defensible extravagance only because each is a single variable file. If the budget tightens, JetBrains Mono is the one to drop for a system monospace stack.

### Bundle size, measured

`apps/web`, production build, before and after this work:

| Build | JS raw | JS gzip | CSS raw | CSS gzip |
| --- | --- | --- | --- | --- |
| Before R13 | 320.76 KB | 101.67 KB | 6.09 KB | 1.98 KB |
| Design system in place, app shell only (no `/design` route) | 324.95 KB | 103.02 KB | 42.03 KB | 8.65 KB |
| After R13, including the `/design` showcase | 452.93 KB | 143.44 KB | 42.79 KB | 8.76 KB |

The design system itself — tokens, typography, the grid, and the primitives the home page uses — costs **+4.19 KB raw / +1.35 KB gzip of JavaScript** and **+35.94 KB raw / +6.67 KB gzip of CSS**. The remaining +128 KB raw / +40.4 KB gzip is the Radix runtime plus the showcase page's own content, which is currently in the main bundle because no route-level code splitting exists yet. Making `/design` a lazy route is the obvious next step and removes almost all of it from the first load of a real page.

Fonts add 139.5 KB of woff2 for an English reader, fetched in parallel with `font-display: swap`.

## Resulting ADR

- **ADR-013** (frontend state architecture) is unchanged and confirmed by this work: server state in TanStack Query, URL state in TanStack Router, local UI state in React, and the one effect in this change (`useThemePreference`) synchronises with the DOM and browser storage, which is exactly what effects are for.
- **ADR-027** (block layout widths) is implemented as the named-line grid in `packages/ui/src/styles/layout.css`, with the breakpoint behaviour it specifies verified in a browser.
- **ADR-019** (design system and accessibility) should record the three recommendations above: Radix Primitives behind an owned layer, the three-family self-hosted type system, and the two-layer token architecture with `data-theme`.
