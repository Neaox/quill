import type { CuratedFaceId } from './faces.ts'

/**
 * Where each curated face's files are (ADR-028: self-hosted, no runtime CDN).
 *
 * The application's bundle declares these faces by hand in
 * `packages/ui/src/styles/fonts.css`, where Vite resolves each file and emits
 * it as a hashed asset. A page the server renders has no bundler behind it —
 * the public site — so the server serves the same files itself and declares
 * them in the theme's stylesheet, and this catalogue is what both agree on.
 * `packages/ui/src/styles/fonts-catalogue.test.ts` reads `fonts.css` and fails
 * when the two disagree, so the catalogue cannot drift from what the
 * application actually ships.
 *
 * Data only: this package depends on no font package. Whoever serves a file
 * resolves `<package>/files/<file>` itself.
 *
 * Only the latin and latin-ext subsets, at the cuts the design system uses,
 * exactly as `fonts.css` declares them: the browser fetches a file only when a
 * character in its range is rendered, so an English page pays for the faces
 * its theme names and nothing else.
 */

export type FaceSubset = 'latin' | 'latin-ext'

export type FaceFile = {
  /** The file's name inside the package's `files/` directory. */
  readonly file: string
  readonly style: 'normal' | 'italic'
  /** A single weight for a static cut, or a range for a variable one. */
  readonly weight: string
  readonly subset: FaceSubset
}

export type CuratedFaceFiles = {
  /** The npm package the files come from. */
  readonly package: string
  readonly files: readonly FaceFile[]
}

/** The `unicode-range` of each subset, as Fontsource publishes it. */
export const SUBSET_UNICODE_RANGES: Readonly<Record<FaceSubset, string>> = {
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
    'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext':
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, ' +
    'U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, ' +
    'U+2C60-2C7F, U+A720-A7FF',
}

const staticCut = (
  stem: string,
  subset: FaceSubset,
  weight: number,
  style: FaceFile['style'] = 'normal',
): FaceFile => ({
  file: `${stem}-${subset}-${weight}-${style}.woff2`,
  style,
  weight: String(weight),
  subset,
})

/**
 * A variable file. `wght` is the weight axis alone; `opsz` is Fontsource's
 * build that carries the optical-size axis beside it, so a heading is set in
 * the display cut and the body in the text cut from the one file.
 */
const variableCut = (
  stem: string,
  subset: FaceSubset,
  weight: string,
  style: FaceFile['style'] = 'normal',
  axes: 'wght' | 'opsz' = 'wght',
): FaceFile => ({ file: `${stem}-${subset}-${axes}-${style}.woff2`, style, weight, subset })

export const CURATED_FACE_FILES = {
  'ibm-plex-sans': {
    package: '@fontsource/ibm-plex-sans',
    files: [
      staticCut('ibm-plex-sans', 'latin', 400),
      staticCut('ibm-plex-sans', 'latin', 500),
      staticCut('ibm-plex-sans', 'latin', 600),
      staticCut('ibm-plex-sans', 'latin', 400, 'italic'),
      staticCut('ibm-plex-sans', 'latin-ext', 400),
      staticCut('ibm-plex-sans', 'latin-ext', 600),
    ],
  },
  'ibm-plex-serif': {
    package: '@fontsource/ibm-plex-serif',
    files: [
      staticCut('ibm-plex-serif', 'latin', 400),
      staticCut('ibm-plex-serif', 'latin', 400, 'italic'),
      staticCut('ibm-plex-serif', 'latin', 600),
      staticCut('ibm-plex-serif', 'latin-ext', 400),
    ],
  },
  'ibm-plex-mono': {
    package: '@fontsource/ibm-plex-mono',
    files: [
      staticCut('ibm-plex-mono', 'latin', 400),
      staticCut('ibm-plex-mono', 'latin', 500),
      staticCut('ibm-plex-mono', 'latin-ext', 400),
    ],
  },
  newsreader: {
    package: '@fontsource-variable/newsreader',
    files: [
      variableCut('newsreader', 'latin', '200 800'),
      variableCut('newsreader', 'latin', '200 800', 'italic'),
      variableCut('newsreader', 'latin-ext', '200 800'),
    ],
  },
  'instrument-sans': {
    package: '@fontsource-variable/instrument-sans',
    files: [
      variableCut('instrument-sans', 'latin', '400 700'),
      variableCut('instrument-sans', 'latin', '400 700', 'italic'),
      variableCut('instrument-sans', 'latin-ext', '400 700'),
    ],
  },
  'instrument-serif': {
    package: '@fontsource/instrument-serif',
    files: [
      staticCut('instrument-serif', 'latin', 400),
      staticCut('instrument-serif', 'latin', 400, 'italic'),
      staticCut('instrument-serif', 'latin-ext', 400),
    ],
  },
  inter: {
    package: '@fontsource-variable/inter',
    files: [
      variableCut('inter', 'latin', '100 900'),
      variableCut('inter', 'latin', '100 900', 'italic'),
      variableCut('inter', 'latin-ext', '100 900'),
    ],
  },
  'source-serif-4': {
    package: '@fontsource-variable/source-serif-4',
    files: [
      variableCut('source-serif-4', 'latin', '200 900', 'normal', 'opsz'),
      variableCut('source-serif-4', 'latin', '200 900', 'italic', 'opsz'),
      variableCut('source-serif-4', 'latin-ext', '200 900', 'normal', 'opsz'),
    ],
  },
  figtree: {
    package: '@fontsource-variable/figtree',
    files: [
      variableCut('figtree', 'latin', '300 900'),
      variableCut('figtree', 'latin', '300 900', 'italic'),
      variableCut('figtree', 'latin-ext', '300 900'),
    ],
  },
  'jetbrains-mono': {
    package: '@fontsource-variable/jetbrains-mono',
    files: [
      variableCut('jetbrains-mono', 'latin', '100 800'),
      variableCut('jetbrains-mono', 'latin-ext', '100 800'),
    ],
  },
} as const satisfies Record<CuratedFaceId, CuratedFaceFiles>
