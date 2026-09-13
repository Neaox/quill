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
