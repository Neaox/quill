# Font licences

This package bundles the curated type set of ADR-028: nine families, from which a theme chooses four — a display, a reading, an interface, and a mono face. All nine are licensed under the **SIL Open Font Licence 1.1**, which is compatible with the MIT licence of this repository. That compatibility is the reason the set is curated at all: a tenant may add a face only by uploading one under a licence that permits the same redistribution, recorded with the theme.

The licence text ships with each dependency; the paths below are relative to this package's `node_modules`.

| Family | Used by | Copyright | Licence text |
| --- | --- | --- | --- |
| IBM Plex Sans | Instrument (display, interface) | Copyright 2019 IBM Corp. | `@fontsource/ibm-plex-sans/LICENSE` |
| IBM Plex Serif | Instrument (reading) | Copyright 2020 IBM Corp. | `@fontsource/ibm-plex-serif/LICENSE` |
| IBM Plex Mono | Instrument (mono) | Copyright 2017 IBM Corp. | `@fontsource/ibm-plex-mono/LICENSE` |
| Newsreader | Press (display, reading) | Copyright 2020 The Newsreader Project Authors | `@fontsource-variable/newsreader/LICENSE` |
| Instrument Sans | Press, Atelier (interface, reading) | Copyright 2022 The Instrument Sans Project Authors | `@fontsource-variable/instrument-sans/LICENSE` |
| Instrument Serif | Atelier (display) | Copyright 2022 The Instrument Serif Project Authors | `@fontsource/instrument-serif/LICENSE` |
| Inter | available to any theme (interface, display) | Copyright (c) 2016 The Inter Project Authors | `@fontsource-variable/inter/LICENSE` |
| Source Serif 4 | available to any theme (reading, display) | Copyright (c) 2014–2021 Adobe | `@fontsource-variable/source-serif-4/LICENSE` |
| JetBrains Mono | Press, Atelier (mono) | Copyright (c) 2020 The JetBrains Mono Project Authors | `@fontsource-variable/jetbrains-mono/LICENSE` |

The OFL permits bundling and redistribution, including in a commercial product, provided the fonts are not sold on their own and the licence and copyright notice travel with them. It also forbids using the Reserved Font Names for a modified version. We ship the fonts unmodified, as `woff2` subsets emitted by the build, and serve them from the application's own origin: there is no runtime request to a font CDN, so a self-hosted installation leaks nothing about its readers.

Only the latin and latin-ext subsets are declared, and every face is gated by `unicode-range`, so a page downloads the three or four faces its theme actually uses and nothing else. The Plex families have no variable build on npm, so they are declared as static cuts at the three weights the design system uses plus an italic; the rest are single variable files.

See `src/styles/fonts.css` for the `@font-face` rules, `packages/theme/src/schema/faces.ts` for the set a theme may choose from, and `docs/research/r13-frontend.md` for the measured sizes.
