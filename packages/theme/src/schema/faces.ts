/**
 * The curated, self-hosted type set (ADR-028). Every face is OFL-1.1, which is
 * what lets the product ship it; an uploaded face carries its own licence
 * metadata for the same reason.
 */

export type FaceRole = 'display' | 'reading' | 'interface' | 'mono'

export type FaceLicence = {
  readonly name: string
  readonly url?: string | undefined
  readonly holder?: string | undefined
}

export type CuratedFace = {
  readonly id: string
  readonly family: string
  readonly roles: readonly FaceRole[]
  /** The CSS fallback chain after the family itself. */
  readonly fallbacks: readonly string[]
  readonly licence: FaceLicence
}

const OFL: FaceLicence = { name: 'OFL-1.1', url: 'https://openfontlicense.org' }

const SANS_FALLBACKS = [
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'sans-serif',
]

const SERIF_FALLBACKS = ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif']

const MONO_FALLBACKS = [
  'ui-monospace',
  'SFMono-Regular',
  'SF Mono',
  'Menlo',
  'Consolas',
  'Liberation Mono',
  'monospace',
]

export const CURATED_FACES = {
  inter: {
    id: 'inter',
    family: 'Inter Variable',
    roles: ['interface', 'display'],
    fallbacks: SANS_FALLBACKS,
    licence: OFL,
  },
  'source-serif-4': {
    id: 'source-serif-4',
    family: 'Source Serif 4 Variable',
    roles: ['reading', 'display'],
    fallbacks: SERIF_FALLBACKS,
    licence: OFL,
  },
  'jetbrains-mono': {
    id: 'jetbrains-mono',
    family: 'JetBrains Mono Variable',
    roles: ['mono'],
    fallbacks: MONO_FALLBACKS,
    licence: OFL,
  },
  'ibm-plex-sans': {
    id: 'ibm-plex-sans',
    family: 'IBM Plex Sans',
    roles: ['interface', 'display'],
    fallbacks: SANS_FALLBACKS,
    licence: OFL,
  },
  'ibm-plex-serif': {
    id: 'ibm-plex-serif',
    family: 'IBM Plex Serif',
    roles: ['reading', 'display'],
    fallbacks: SERIF_FALLBACKS,
    licence: OFL,
  },
  'ibm-plex-mono': {
    id: 'ibm-plex-mono',
    family: 'IBM Plex Mono',
    roles: ['mono'],
    fallbacks: MONO_FALLBACKS,
    licence: OFL,
  },
  newsreader: {
    id: 'newsreader',
    family: 'Newsreader',
    roles: ['reading', 'display'],
    fallbacks: SERIF_FALLBACKS,
    licence: OFL,
  },
  'instrument-sans': {
    id: 'instrument-sans',
    family: 'Instrument Sans',
    roles: ['interface', 'reading', 'display'],
    fallbacks: SANS_FALLBACKS,
    licence: OFL,
  },
  'instrument-serif': {
    id: 'instrument-serif',
    family: 'Instrument Serif',
    roles: ['display'],
    fallbacks: SERIF_FALLBACKS,
    licence: OFL,
  },
} as const satisfies Record<string, CuratedFace>

export type CuratedFaceId = keyof typeof CURATED_FACES

export const CURATED_FACE_IDS = [
  'inter',
  'source-serif-4',
  'jetbrains-mono',
  'ibm-plex-sans',
  'ibm-plex-serif',
  'ibm-plex-mono',
  'newsreader',
  'instrument-sans',
  'instrument-serif',
] as const satisfies readonly CuratedFaceId[]

/** Total by construction: the schema only admits an id this record declares. */
export const curatedFace = (id: CuratedFaceId): CuratedFace => CURATED_FACES[id]

export const CURATED_FACE_LIST: readonly CuratedFace[] = Object.values(CURATED_FACES)
