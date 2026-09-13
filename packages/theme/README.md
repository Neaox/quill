# @quill/theme

Themes are declarative documents, not CSS (ADR-028). This package owns the document schema, the three built-in identities, the OKLCH palette generator, and the theme doctor.

- `validateThemeDocument(input)` — TypeBox schema checked by ajv, returning structured issues.
- `generateTheme(document)` — `{ light, dark, report }`, where the token maps are exactly the custom properties `packages/ui/src/styles/tokens.css` resolves, plus `--token-*`, type, shape, and layout.
- `toCss(generated, { selector })` — the `:root`, `prefers-color-scheme`, and `data-theme` blocks, in that resolution order.
- `runThemeDoctor(document)` — every rule in `docs/design/colour-rules.md` as pass, adjusted, or warn. AA text contrast is enforced by default and can be made advisory; everything else advises.
- `BUILTIN_THEMES` / `DEFAULT_THEME` — Press, Instrument (the default), Atelier, with the seeds and variants of the design canvas artboards.
- `extractSeedsFromColours`, `suggestBase`, `forkTheme` — the onboarding flow's three steps.

Palettes are generated, never hand-picked: a neutral ramp at the lightness bands of section 3, accent variants nudged until the contrast floors hold, a status set at matched lightness and chroma, and syntax colours at fixed hues. Dark mode is a re-derivation with the chroma reduced, never an inversion. Every place the generator changed what the seeds asked for is reported.

Nothing here touches the DOM. Tenants get the colours they asked for wherever those colours are safe, and a derived colour with a named reason wherever they are not.
