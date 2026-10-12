import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { CURATED_FACE_FILES, CURATED_FACE_IDS } from '@quill/theme'

/**
 * The curated faces' files, served by this server (ADR-028: self-hosted, no
 * runtime CDN).
 *
 * The application's bundle carries these files as hashed assets of its own,
 * but a page this server renders has no bundle behind it — the public site —
 * so without this every theme fell back to a system font on the web. The
 * catalogue of which files exist is `@quill/theme`'s
 * (`schema/face-files.ts`), held to the application's `fonts.css` by a test;
 * the files themselves come from the same Fontsource packages the
 * application resolves, which is why `@quill/server` depends on them.
 *
 * **Every file is addressed by its own content.** The served name is the
 * package's file name with a hash of its bytes in it —
 * `/api/fonts/inter-latin-wght-normal.<16 hex>.woff2` — so it can be cached
 * as immutable for a year, and a package upgrade that changes a file changes
 * its address rather than leaving a year of browsers holding the old one.
 *
 * **Read once, at boot.** About a megabyte for the whole curated set, held in
 * memory: a font request never touches the disk, and a stylesheet can name
 * its files' addresses without waiting on anything.
 */

/** Where a served face lives. Under `/api`, beside the attachments a public page also reads. */
export const FONT_ROUTE_PREFIX = '/api/fonts'

/** A served name: the package's own file stem, a 16-hex content hash, `.woff2`. */
export const SERVED_FONT_NAME = /^[a-z0-9-]+\.[0-9a-f]{16}\.woff2$/u

/** A year, in seconds: the lifetime of something addressed by its own content. */
export const FONT_MAX_AGE_SECONDS = 31_536_000

export interface ServedFace {
  readonly name: string
  readonly bytes: Buffer
}

export interface FaceFiles {
  /**
   * The address a curated face's file is served at.
   *
   * Throws for a file the catalogue does not list, because that is a bug in
   * the catalogue rather than a request somebody made.
   */
  href(packageName: string, file: string): string
  /** The file served under this name, or null when there is none. */
  byName(name: string): ServedFace | null
}

/** Reads one catalogued file. Injectable so a test can serve bytes it chose. */
export type FaceFileReader = (packageName: string, file: string) => Promise<Buffer>

const readFromPackage: FaceFileReader = (packageName, file) =>
  readFile(fileURLToPath(import.meta.resolve(`${packageName}/files/${file}`)))

const servedName = (file: string, bytes: Buffer): string =>
  `${file.replace(/\.woff2$/u, '')}.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.woff2`

export async function createFaceFiles(read: FaceFileReader = readFromPackage): Promise<FaceFiles> {
  const entries = await Promise.all(
    CURATED_FACE_IDS.flatMap((id) => {
      const { package: packageName, files } = CURATED_FACE_FILES[id]
      return files.map(async ({ file }) => {
        const bytes = await read(packageName, file)
        return { key: `${packageName}/${file}`, served: { name: servedName(file, bytes), bytes } }
      })
    }),
  )
  const byKey = new Map(entries.map((entry) => [entry.key, entry.served]))
  const byName = new Map(entries.map((entry) => [entry.served.name, entry.served]))

  return {
    href(packageName, file) {
      const served = byKey.get(`${packageName}/${file}`)
      if (served === undefined) throw new Error(`No curated face file ${packageName}/${file}`)
      return `${FONT_ROUTE_PREFIX}/${served.name}`
    },
    byName(name) {
      return byName.get(name) ?? null
    },
  }
}

/**
 * The curated faces, read off disk once per process.
 *
 * Memoised on the promise, like the design system's CSS, so the server and a
 * test harness starting together share the one read.
 */
let faceFiles: Promise<FaceFiles> | null = null

export function loadFaceFiles(): Promise<FaceFiles> {
  faceFiles ??= createFaceFiles()
  return faceFiles
}
