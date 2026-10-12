# ADR-028: Theming architecture

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 14 and 29; ADR-019, ADR-023, ADR-027; research R13; design canvas `docs/design/canvas`

## Context

The product must be polished with an identity of its own, and tenants must be able to choose and adjust that identity, while readers keep personal preferences such as light or dark mode. Unbounded theming (arbitrary CSS, per-token colour pickers) is how polished products become unpolished. Three built-in identities exist on the design canvas: Press, Instrument, Atelier.

## Decision

Theming is four layers. Each layer may only change what the layer below exposes.

### Layer 0: invariants (never themable)

Spacing scale, type scale ratio, control heights and hit targets, the content/wide/full layout grid, focus-ring behaviour, motion tokens and reduced-motion handling, keyboard behaviour, and WCAG 2.2 AA contrast floors. These are what make every theme feel finished.

### Layer 1: theme (identity)

A theme is a declarative document, not CSS. It chooses:

- **Type pairing** from the curated, self-hosted set: display, reading, interface, and mono faces.
- **Signature layout variants** from a bounded set implemented as component variants: sidenotes versus a side panel for comments and provenance; a revision timeline versus a history menu; coloured collection tabs versus a plain tree; a status readout versus a breadcrumb bar; double rules versus hairlines versus cards.
- **Shape and density**: a radius scale and a density step.
- **Colour seeds**: a neutral tone (hue and chroma of the greys) and one accent hue. Not individual tokens.
- **Which levers onboarding surfaces first**, with suggested ranges. These are defaults for the guided path, not limits on what a tenant may change.

Built-in themes ship as Press, Instrument, and Atelier. Each is complete and usable as it is. **Instrument is the default** for a new instance, because it fits the first users best; the design system is tuned on it first. A custom theme is the same document with different values, validated by schema, and is normally created by forking a built-in one and changing as little or as much as the tenant wants.

### Amendment (12 September 2026): theme versus layout

The "signature layout variants" above are **not part of the theme**. A theme is identity, and an organisation's documentation stays cohesive only if identity never varies inside it: the same type pairing, colour seeds, radius, and density everywhere. Whether a workspace's navigation is a plain tree or coloured collection tabs, whether comments sit in a side panel or as sidenotes, whether history is a timeline or a menu, whether the header is a readout or a breadcrumb bar, and whether sections are divided by rules, hairlines, or cards, are **layout** choices, and a product workspace may reasonably want a different one from an engineering workspace.

So the model is:

- **Theme** (Layer 1): identity only. Chosen per organisation; a workspace inherits it and may not change it.
- **Layout**: the bounded set of variants above, as one declarative `layout` value chosen **per workspace**, with an organisation-level default. A built-in theme still *recommends* a layout (Press suggests sidenotes and rules; Atelier suggests tabs and cards; Instrument suggests the tree, the panel, and hairlines), which is what onboarding and a new workspace start from, but the recommendation is a default, not a coupling.
- The **navigation sidebar shows the current workspace only**: its collections and documents. Moving between workspaces is the workspace switcher in the top bar, never a sidebar that lists several workspaces at once.
- The **public site's top navigation** (the links beside the site name) is tenant-configurable through the settings document (ADR-034); the in-app top bar's fixed controls (search, share, edit, account) are not.

**Who decides what.** Three parties have different needs, and each setting has exactly one owner; the others inherit and may not override unless the owner delegates.

| Decision | Organisation (tenant) | Workspace | Person |
| --- | --- | --- | --- |
| Identity: colour seeds, radius, density, logo and name | **owns** | inherits | inherits |
| Shell type: the interface, display, and mono faces every screen is built from | **owns** | inherits | inherits |
| Content faces: the reading face, plus any additional faces a workspace's documents need (a technical workspace may add to the set for its content; it never changes the shell) | sets the default and the allowed set | may add for its content | inherits |
| Layout: navigation, comments, history, header, rules | sets the default | **owns** (may be locked by the organisation) | inherits |
| Public site top navigation and publish policy | **owns** | inherits | — |
| Collections, templates, required sections, what the sidebar contains | sets conventions | **owns** | — |
| Colour scheme, reduced motion, high contrast (follow the person everywhere) | may not remove | may not remove | **owns** |
| Tone (warm, cool, neutral greys) | **owns** | inherits | may choose only if the organisation allows it |
| Personal preferences: text size, pins and recents, editor and keyboard habits | — | — | **owns** |

A person is a **reader** on the reading and presenting surfaces and a **writer** in the editor, and most people are both. That is not a mandate for two of every preference; it is a question to ask of each view and state as it is designed: *would a reader and a writer want to see something different here?* Sometimes yes (a larger reading size should not enlarge the editor; a writer wants lock and autosave status where a reader wants a clean page), often no. Where the answer is yes, the preference or the presentation splits by role; where it is no, there is one.

Implementation: the `variants` block of the theme document and the `ThemeVariants` type become `layout`/`Layout`, applied through the same `data-*` attributes but set at workspace level rather than from the theme; the three built-in themes keep their variant values as `recommendedLayout`. Scheduled with the workspace settings work in M3; until then the attributes still come from the theme, which is indistinguishable while every workspace uses the tenant default.

### Amendment (11 October 2026): a lockstay register of its own, and plain space

A fourth built-in theme ships beside the three on the canvas. It is the design system of the lockstay documentation portal: raised white surfaces on a cool page, one quiet teal, Figtree for display, reading and interface, and no ornament between sections. Its reason to exist is that a documentation site moved onto Quill should be able to look like the site it came from, and lockstay is the first such site. It was drafted as "Calm", lockstay's own name for its design system, and renamed **Grid** before it was released (see the next amendment), so that "Calm" could name the survey's quiet default. Instrument stays the default for now.

Three things the theme document could not say were added for it, each as an extension of the generator rather than an exception to it, and each available to every theme:

- **A body ink.** Palettes now carry `body` (`--palette-body`, `--color-body`) between `ink` and `muted`: running text is set a visible step quieter than headings and emphasis, and is held to the full body contrast floor. Every built-in now reads in three inks rather than two.
- **Lightness steps.** `seeds.tone.steps.light` and `.dark` may state where paper, surface, raised, border, body, muted and ink start, for a theme whose tonal register is not the shared one. Hue and chroma stay the tone's, so the tone lever keeps working on a fork; the generator still settles every text role against the floors, and the doctor still judges every role against its band. `seeds.accent.darkLightness` does the same for the dark accent.
- **Plain space.** `rules: plain` joins hairline, double and cards: the space above a heading is the separation, and tables lose their ruled monospace header. It is a layout value, so any workspace may choose it.

~~The type scale stays layer 0.~~ Superseded by the next amendment: the scale's *proportions* stay layer 0 by construction, but its anchor and steps are now a theme's to state.

### Amendment (11 October 2026): three base themes, a reading setting, and a superseded Press

The documentation design survey (`docs/research/2026-10-11-documentation-design-survey.md`) measured what the best documentation sites share and proposed three base themes. They ship as built-ins beside Instrument and Atelier:

| Theme | Faces | Register | Tone and accent | Reading setting | Radius | Layout it recommends |
| --- | --- | --- | --- | --- | --- | --- |
| **Calm** (survey Theme A, the candidate default) | Inter throughout; JetBrains Mono | quiet modern sans: lockstay, Linear, Fumadocs, PlanetScale | tone 255 at C 0.0055; paper L 98.5, white cards, charcoal L 17 in dark; accent indigo 262 at C 0.15, L 53 / 72 | 16 / 26 px, 42 rem column; h1 32 / 38 at 640, h2 22 / 28 at 620, h3 17.5 / 26; ink links with a 1.25 px accent underline | step 3 (6, 9, 12 px) | tree, panel, menu, breadcrumb, plain space |
| **Editorial** (Theme B) | Source Serif 4 with optical sizes for prose and headings; Inter for chrome; JetBrains Mono | long-form reading: Increment, the Claude Platform docs | warm tone 70 at C 0.008; paper L 97.5, warm charcoal L 18.5; body set strong (L 30); accent rust 35 at C 0.13, L 48 / 72 | 18.5 / 31 px, 40 rem column, 22 px dek; h1 40 / 46 and h2 27 / 34 at 560; ink links with a 1 px accent underline at 3.5 px | step 2 (4, 6, 8 px) | sidenotes, menu, tree, breadcrumb, plain space |
| **Grid** (Theme C, as lockstay) | Figtree throughout; JetBrains Mono | lockstay's portal, reproduced as closely as the document can say it | tone 215 at C 0.008; lockstay's lightness steps (paper 97.2 / 19, raised 100 / 23, hairline 90 / 29); accent teal 190, L 47 / 78, accent ink L 44 / 84; lockstay's current-item wash as an override | 15 / 24 px, 46 rem (736 px) column, 17 / 27.2 lede; h1 34 / 40 at 700, h2 21 / 27 at 650, h3 17 / 23, 48 px above an h2; teal links, 1 px underline at 3 px, 2 px on hover | step 3 with a 10 px `md` | tree, panel, menu, breadcrumb, plain space, **start-aligned** column |

Where the survey's Grid and lockstay disagree, lockstay wins, by the owner's decision: Figtree rather than Geist (no new face, and Figtree is what makes lockstay read as lockstay), a cool tinted neutral rather than zero-chroma greys, and teal rather than signal orange. Grid therefore needs no new font dependency. In three places lockstay is further from `docs/design/colour-rules.md` than a theme Quill designs itself would be — its dark card sits 1.5 above the panel beneath rather than 3, and its current-item wash is more saturated than the area budget, more so in dark — and the owner chose fidelity. The doctor reports those three warnings on Grid and the tests hold the list to exactly them; text contrast holds everywhere, as on every built-in.

What the theme document could not say, added as extensions of the generator and available to every theme:

- **A reading setting**, `type.scale`: the body size and leading and the content column (`--text-reading`, `--leading-reading`, `--layout-content`), and optionally the lede, h1 to h4 (size, line height, weight, tracking), the space above h2 and h3, the eyebrow, table cells and block code, emitted as the `--prose-*` custom properties. Every heading, lede and space is an `em` of the body, so the presentation surface, which raises the body, still rescales the whole document together; the scale's proportions are no longer fixed, but its structure — one anchor, everything relative to it — still is. The furniture (eyebrow, tables, code) is in `rem`, as before. Bounds are the survey's: a body of 14 to 20 px, a leading of 1.4 to 1.9, a column of 32 to 48 rem. A theme that states nothing emits exactly the values `prose.css` used to write, so Instrument, Atelier and every saved document render as they did.
- **Links**, `type.links`: whether link text is ink or accent ink, whether the underline is quiet, accent or the text's own colour, and its thickness, hover thickness and offset (`--prose-link-*`). The survey's finding is that the best sites keep link text calm and put the signal in the underline; Grid is the exception because lockstay colours its links.
- **Accent ink**, a generated palette role (`--palette-accent-ink`, `--color-accent-ink`): the accent as text on the page, a step further from the paper than the accent a control is filled with (L −3 in light, +6 in dark), settled against the secondary floor on paper, surface and raised, and checked by the doctor on the accent wash as well.
- **Alignment**, `align: centre | start` in the layout (optional; every saved layout reads as `centre`): `start` puts the reading column flush beside the navigation with wide blocks breaking out to the right only (`data-align` in `layout.css`). It is a layout value, like `rules`.

**Press is superseded by Editorial.** The two were the same idea, warm paper and a serif column, and Editorial is the finished one. Press is no longer offered, and its id resolves to Editorial (`SUPERSEDED_THEMES`, `successorOf`): `BUILTIN_THEMES.press` is Editorial's document, `data-theme-id="press"` paints Editorial, a new fork of Press records `base: 'editorial'`, and "reset" on an old Press fork resets to Editorial while keeping the base it saved. An organisation's settings hold the whole document they saved, so an organisation on Press keeps exactly Press — Newsreader, oxblood, double rules — and the theme editor now forks the *saved* document on the first lever rather than the built-in by id, so moving one lever can never swap the rest for a successor's values. `BUILTIN_THEME_IDS`, the set a `base` may name, keeps `press` for ever; `OFFERED_THEME_IDS` is what a chooser shows. The frozen Press document stays in `@quill/theme` as the fixture that proves a saved Press still validates, generates and passes contrast.

Instrument and Atelier stay as distinct themes for now; the survey's recommendations for them, and for the default, are recorded in the pull request rather than enacted here.

### Layer 2: tenant customisation (organisation or workspace)

A built-in theme is a **starting point, not a boundary**. It is complete and works as it is; most tenants will change little. But a tenant may change anything in the theme document: every colour seed and every generated token, the type pairing including uploaded faces under a compatible licence, every signature variant, radius, density, and per-collection colours. The theme editor presents this in two tiers so the common case stays simple:

- **Levers**, shown first: accent, tone, logo and name, reading face, radius, density, collection colours. These are what onboarding sets and what most tenants ever touch.
- **Everything else**, one click away: individual tokens, variants, and fonts, with the theme doctor's report beside each change.

The theme doctor **advises, it does not block**: every rule in `docs/design/colour-rules.md` reports pass, adjusted, or warn, with the reason, and a tenant may keep a warned value. The one default that is enforced is AA text contrast, because most organisations are bound to it; an instance administrator can switch that enforcement to advisory. That switch is `policies.contrastEnforcement` in the organisation's settings document (ADR-034), a policy rather than part of the theme — it says how strictly *any* theme this organisation saves is judged, and it outlives the theme it was set beside. It changes what the doctor **reports**, `enforced` on the rule and `enforcedRulesHold` on the report, and never whether a save is accepted: the refusal belongs in the theme editor, in front of the administrator who can see the reason and the switch. A workspace may override its organisation's theme only if the organisation allows it. Customisation is expressed in the theme document, never as CSS.

### Layer 3: user preferences

Colour scheme (light, dark, system), text size, reduced motion, high contrast. These belong to the reader, follow them across workspaces, and no tenant setting can remove them. Whether members may also choose the tone is a per-tenant switch, off by default, because tone is identity.

### Generation, not hand-picking

Light and dark palettes are **generated** from the theme's tone and accent seeds in OKLCH: a neutral ramp from the tone's hue and chroma at fixed lightness steps; the dark palette from the same seeds with inverted lightness and reduced chroma; accent variants (hover, subtle, foreground-on-accent, focus ring) derived from the accent. Every generated pair is checked against the AA floors, and an accent that fails is nudged in lightness until it passes, with the adjustment reported in the theme editor. This is what makes a custom accent safe: the tenant chooses a hue, the system guarantees the ratios.

### Where a theme applies

The theme of the workspace or collection that published a document applies everywhere that document appears: the application, the public site, presentation mode, HTML and PDF export. Exports embed the generated tokens so they look right offline.

### Delivery

The theme document resolves to a set of CSS custom properties served with the page and cached by content hash. The existing two-layer token system (raw palette, semantic layer) is the target: a theme change is a palette change, never a rebuild. Signature variants are props on the shell and document components, so a theme is a configuration, and the component set stays one codebase.

### Amendment (11 October 2026): how delivery works

Built as above, with four specifics this section did not state. The routes are in `docs/architecture/api-contract-settings.md` ("The theme, delivered").

- **Linked, not inlined.** The application is a static bundle with no server-rendered HTML to put the properties in, so "served with the page" is a stylesheet the page links: `GET /api/settings/organisation/theme.css`, generated on the server from the organisation's theme document, so the generator and the doctor never enter a reader's bundle (review 2026-09-13, H1). "Cached by content hash" is a strong `ETag` of the CSS's own SHA-256 with `Cache-Control: public, no-cache`, which revalidates to an empty `304`, and the application links it as `…/theme.css?v=<hash>` so a save is a new address it can swap to without a reload. The public site embeds the same CSS, byte for byte, at the head of its own content-addressed, immutable stylesheet rather than linking it, so a public page stays one request.
- **Scoped to the identity, one step above the bundle.** The bundle keeps every built-in identity's palette. The delivered sheet is scoped to `html:root[data-theme-id='<identity>']` — one type selector more specific than the bundle's `:root[data-theme-id=…]` — so a customised theme wins over the built-in it was forked from in whichever order the browser meets the two sheets, and a page whose sheet has not arrived yet is the built-in, not unstyled. The **identity** written on `<html>` is the built-in a theme was forked from (`base`), or the theme's own id when it is a built-in or was never forked, so identity variants such as `theme-press:` still apply to a customised Press.
- **Layout that the stylesheet reads travels with it.** Two layout axes are read from an ancestor attribute rather than passed to a component: `data-rules` and `data-align`. Both are written on `<html>` beside the identity, by the application and by the public site, each from the organisation's layout default if it states that axis and otherwise from the theme's variants. A workspace's own override stays on its shell.
- **Faces travel with it.** The sheet ends with the `@font-face` rules for the faces the theme names. The curated faces' files are served by the server from the same Fontsource packages the application bundles, each at an address carrying a hash of its bytes, and `@quill/theme`'s face catalogue is held to the application's `fonts.css` by a test. An uploaded face is declared only from a rooted, same-origin URL, because `font-src 'self'` would refuse any other.
- **Public.** The theme is on every public page and every share link, neither of which has a session, so the theme's routes read none. They answer with the generated CSS and the identity, never the organisation's name, policies, or revision, and count against the public site's per-address rate limit.

### Colour rules

The generator and the theme doctor implement the measurable rules in `docs/design/colour-rules.md`: WCAG and APCA contrast floors, lightness bands per role, a chroma budget that falls with area, hue-agreement rules between neutrals, accent, and status colours, dark mode as a re-derivation with reduced chroma, and colour-vision-deficiency separation. Each rule reports pass, adjusted with the adjustment named, or warn.

### Onboarding: from brand to theme

A tenant's first theme is created by a short guided flow rather than a settings page:

1. **Brand inputs.** Upload a logo (SVG or PNG) and, optionally, enter brand colours. The system extracts candidate colours in OKLCH: the most chromatic becomes the accent candidate, and the warmth of the brand's neutrals sets the suggested tone. An accent that is too light for text keeps its exact value for marks and surfaces while a darker, contrast-safe variant is derived for links and controls, and the flow says so.
2. **Three questions.** What the workspace mostly holds (runbooks and designs, guides and references, policies and process); how the team wants it to feel (precise, editorial, friendly); how dense they like their tools (compact, comfortable). The answers map to a suggested built-in theme: Instrument, Press, or Atelier.
3. **Live preview.** The suggestion is shown on a real document, not swatches: the reading surface with a table, a callout, and code, in light and dark, with the tenant's logo and accent applied. The other two themes are one click away for comparison.
4. **Tweak, then save.** The layer 2 levers are exposed inline: accent, tone, reading face, radius and density. Every change re-generates the palettes and re-checks contrast. Saving creates the tenant's theme as a fork of the chosen built-in, so it can be re-opened and adjusted later from settings, or reset to the base.

The flow runs when an organisation is created and is re-runnable from settings. Workspaces inherit the organisation's theme and may run a reduced version (accent, logo, per-collection colours) if the organisation allows it.

### Escape hatch

There is no custom CSS in the first release. If public sites later need it, it is a separate, sandboxed, public-site-only setting with a visible "unsupported customisation" flag, never applied inside the application.

## Alternatives considered

- **Per-token colour pickers as the primary interface.** Rejected as the first thing a tenant sees: it produces incoherent palettes. Seeds and levers come first and generate a coherent palette; individual tokens remain editable underneath, with the doctor's advice beside them.
- **Limiting tenants to theme-exposed levers.** Considered and rejected: built-in themes are starting points, and a tenant who wants to go further should be able to, with advice rather than refusal.
- **Arbitrary CSS injection.** Rejected for the application entirely; considered later for public sites only.
- **A single theme with light and dark.** Rejected: tenants want identity, and the three directions on the canvas are genuinely different products to a reader.
- **User-selectable theme.** Rejected: identity is the tenant's; the reader keeps scheme, size, motion, and contrast.

## Consequences

- The theme document schema, the palette generator with its contrast checks, and the "theme doctor" validation are built in M1 with the design system, before any feature screen.
- Every signature variant is a real component variant with tests, so the bounded set stays bounded on purpose: adding a variant is a design decision, not a CSS tweak.
- Font choices are limited to the curated, self-hosted, OFL-licensed set; a tenant may add a face only by uploading one under a compatible licence, recorded with the theme.
- The design canvas's tone, accent, and reading-face tweaks are exactly layer 2 levers, so the canvas doubles as the specification for the theme editor.
