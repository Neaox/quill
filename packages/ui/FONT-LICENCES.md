# Font licences

This package bundles the curated type set of ADR-028: ten families, from which a theme chooses four — a display, a reading, an interface, and a mono face. All ten are licensed under the **SIL Open Font Licence 1.1**, which is compatible with the MIT licence of this repository. That compatibility is the reason the set is curated at all: a tenant may add a face only by uploading one under a licence that permits the same redistribution, recorded with the theme.

The licence text ships with each dependency; the paths below are relative to this package's `node_modules`.

| Family | Used by | Copyright | Licence text |
| --- | --- | --- | --- |
| IBM Plex Sans | Instrument (display, interface) | Copyright 2019 IBM Corp. | `@fontsource/ibm-plex-sans/LICENSE` |
| IBM Plex Serif | Instrument (reading) | Copyright 2020 IBM Corp. | `@fontsource/ibm-plex-serif/LICENSE` |
| IBM Plex Mono | Instrument (mono) | Copyright 2017 IBM Corp. | `@fontsource/ibm-plex-mono/LICENSE` |
| Newsreader | Press as saved (display, reading); available to any theme | Copyright 2020 The Newsreader Project Authors | `@fontsource-variable/newsreader/LICENSE` |
| Instrument Sans | Atelier (interface, reading); Press as saved | Copyright 2022 The Instrument Sans Project Authors | `@fontsource-variable/instrument-sans/LICENSE` |
| Instrument Serif | Atelier (display) | Copyright 2022 The Instrument Serif Project Authors | `@fontsource/instrument-serif/LICENSE` |
| Figtree | Grid (display, reading, interface) | Copyright 2022 The Figtree Project Authors | `@fontsource-variable/figtree/LICENSE` |
| Inter | Calm (display, reading, interface), Editorial (interface) | Copyright (c) 2016 The Inter Project Authors | `@fontsource-variable/inter/LICENSE` |
| Source Serif 4 | Editorial (display, reading), with its optical-size axis | Copyright (c) 2014–2021 Adobe | `@fontsource-variable/source-serif-4/LICENSE` |
| JetBrains Mono | Calm, Editorial, Grid, Atelier (mono) | Copyright (c) 2020 The JetBrains Mono Project Authors | `@fontsource-variable/jetbrains-mono/LICENSE` |

The OFL permits bundling and redistribution, including in a commercial product, provided the fonts are not sold on their own and the licence and copyright notice travel with them. It also forbids using the Reserved Font Names for a modified version. We ship the fonts unmodified, as `woff2` subsets emitted by the build, and serve them from the application's own origin: there is no runtime request to a font CDN, so a self-hosted installation leaks nothing about its readers.

Only the latin and latin-ext subsets are declared, and every face is gated by `unicode-range`, so a page downloads the three or four faces its theme actually uses and nothing else. The Plex families have no variable build on npm, so they are declared as static cuts at the three weights the design system uses plus an italic; the rest are single variable files. Source Serif 4 is the optical-size build, which carries the `opsz` axis beside `wght` so a heading is set in the display cut and the body in the text cut; it is about 70 KB more per subset than the weight-only build, paid only by a theme that reads in it.

See `src/styles/fonts.css` for the `@font-face` rules, `packages/theme/src/schema/faces.ts` for the set a theme may choose from, and `docs/research/r13-frontend.md` for the measured sizes.
