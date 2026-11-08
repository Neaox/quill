import type { SourceCollection } from '../ports/source-sync.ts'

/**
 * The small, pure rules the sync job applies to a source's paths (ADR-061):
 * which files are documents, which collection a file belongs to, and what a
 * document with no title of its own is called.
 */

const DOCUMENT_EXTENSION = /\.(?:md|markdown)$/i
const FOLDER_DOCUMENT = /^(?:index|readme)$/i

/** A Markdown file is a document; anything else under the source's paths is not, yet. */
export function isDocumentPath(path: string): boolean {
  return DOCUMENT_EXTENSION.test(path)
}

/**
 * The collection a file belongs to: the one with the longest path the file
 * lies under, so a collection nested inside another's directory takes its
 * own files. Null when no collection reads it.
 */
export function collectionFor(
  path: string,
  collections: readonly SourceCollection[],
): SourceCollection | null {
  let best: SourceCollection | null = null
  let bestLength = -1
  for (const collection of collections) {
    const prefix = collection.path.replace(/^\.?\/+/, '').replace(/\/+$/, '')
    const covers = prefix === '' || path === prefix || path.startsWith(`${prefix}/`)
    if (covers && prefix.length > bestLength) {
      best = collection
      bestLength = prefix.length
    }
  }
  return best
}

/**
 * What a document is called when neither its front matter nor a first heading
 * names it: its file name, humanised. An `index.md` or `README.md` is named
 * after its folder, which is what it describes.
 */
export function titleFromPath(path: string): string {
  const slash = path.lastIndexOf('/')
  const file = path.slice(slash + 1).replace(DOCUMENT_EXTENSION, '')
  const parent = path.slice(0, Math.max(slash, 0))
  const folder = parent.slice(parent.lastIndexOf('/') + 1)
  const name = FOLDER_DOCUMENT.test(file) && folder.length > 0 ? folder : file
  const words = name.replaceAll(/[-_\s]+/g, ' ').trim()
  return words.length === 0 ? 'Untitled' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** A file's text, or null when it is not UTF-8, which a Markdown document must be. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return UTF8.decode(bytes)
  } catch {
    return null
  }
}
