import { BRAND } from '@quill/brand'
import type { DocumentId } from '@quill/domain'

import { titleFromPath } from './source-files.ts'

/**
 * Folders as documents (ADR-061, "Tree, titles and order"): a sourced
 * collection's tree follows the repository's folders.
 *
 * Inside a collection's directory, each folder that holds a document, however
 * deep, has a document of its own, the parent of what the folder holds. That
 * is its index file, `index.md`, or else its `README.md`. A folder with
 * neither gets a document Quill writes: titled after the folder, its body a
 * child pages block (ADR-058), stored at a path no repository file can take
 * (`generatedFolderPath`). The collection's own directory is the collection,
 * so its index file is an ordinary document at the top of it.
 *
 * The plan is a pure function of which documents are live and where, so the
 * sync job can compute it before and after a revision and compare the two.
 */

/** The file name of a folder document Quill writes, inside the folder it stands for. */
const GENERATED_FOLDER_SUFFIX = `/.${BRAND.slug}/folder.md`

/** Index file names, best first: `index` wins over `README` (ADR-061). */
const INDEX_FILE = /^(index|readme)\.(?:md|markdown)$/iu

/** Where the document Quill writes for a folder with no index file is stored. */
export function generatedFolderPath(folder: string): string {
  return `${folder}${GENERATED_FOLDER_SUFFIX}`
}

/** The folder a generated folder document stands for; null for any other path. */
export function generatedFolderOf(path: string): string | null {
  return path.endsWith(GENERATED_FOLDER_SUFFIX) && path.length > GENERATED_FOLDER_SUFFIX.length
    ? path.slice(0, -GENERATED_FOLDER_SUFFIX.length)
    : null
}

/** The directory a path is in; `''` for a path at the repository's root. */
export function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** How good an index file a path is: 0 for `index`, 1 for `README`, null for neither. */
function indexRank(path: string): number | null {
  const match = INDEX_FILE.exec(path.slice(path.lastIndexOf('/') + 1))
  if (match === null) return null
  return match[1]?.toLowerCase() === 'index' ? 0 : 1
}

/** Whether `path`'s file name is one a folder's document may have. */
export function isIndexFileName(path: string): boolean {
  return indexRank(path) !== null
}

/** What a generated folder document is called: the folder's name, humanised. */
export function folderTitle(folder: string): string {
  return titleFromPath(`${folder}/README.md`)
}

/** Inline Markdown punctuation, escaped in a folder's name so the heading says exactly that. */
const INLINE_PUNCTUATION = /[\\`*_[\]<>!#~&|]/gu

/**
 * The body of a generated folder document, before its id is stamped: a
 * heading that names it, as a repository's own README does, and the pages
 * under it (ADR-058).
 */
export function generatedFolderMarkdown(folder: string): string {
  const heading = folderTitle(folder).replaceAll(INLINE_PUNCTUATION, String.raw`\$&`)
  return `# ${heading}\n\n::children{excerpts}\n`
}

/** A live document as the plan reads it: where it is and which collection it is in. */
export interface FolderPlanDocument<C extends string> {
  readonly path: string
  readonly collection: C
}

/** A collection as the plan reads it: its id, and the directory its documents are relative to. */
export interface FolderPlanCollection<C extends string> {
  readonly collection: C
  /** The literal directory in front of the collection's path (`sourcePatternPrefix`). */
  readonly root: string
}

export interface FolderPlan<C extends string> {
  /** The folders whose document Quill writes, by the folder's path, with the collection each is in. */
  readonly generated: ReadonlyMap<string, C>
  /** The file that is each folder's document, by the folder's path. */
  readonly indexes: ReadonlyMap<string, string>
  /**
   * Where each document goes, by its path (a generated folder's by its
   * generated path): the path of the document it nests under, or null at
   * the top of its collection.
   */
  readonly parents: ReadonlyMap<string, string | null>
  /** The folder each folder document stands for, by the document's path. */
  readonly folderOf: ReadonlyMap<string, string>
  /**
   * Each collection's own index file, at the top of its directory: the
   * collection's overview, which goes first among the documents at its top.
   */
  readonly leading: ReadonlySet<string>
}

/**
 * The folders of the live documents. A folder with an index file in any
 * collection is never also written for another, and collections are read in
 * the layout's order: of two collections that would each write a document
 * for the same folder, the first does. The other collection's documents in
 * that folder nest one folder further up, so no two documents ever claim one
 * stored path, and no folder has two pages.
 */
export function planFolders<C extends string>(
  documents: Iterable<FolderPlanDocument<C>>,
  collections: readonly FolderPlanCollection<C>[],
): FolderPlan<C> {
  const byCollection = new Map<C, string[]>()
  for (const { path, collection } of documents) {
    if (generatedFolderOf(path) !== null) continue
    const list = byCollection.get(collection)
    if (list === undefined) byCollection.set(collection, [path])
    else list.push(path)
  }

  // Each collection once, in order, with each of its folders' best index file.
  const seen = new Set<C>()
  const overviews = new Map<C, { readonly path: string; readonly rank: number }>()
  const read = collections.flatMap(({ collection, root: written }) => {
    if (seen.has(collection)) return []
    seen.add(collection)
    const paths = byCollection.get(collection) ?? []
    const root = written.replace(/\/+$/u, '')
    const inside = (directory: string): boolean =>
      root === '' ? directory !== '' : directory.startsWith(`${root}/`)
    const ranked = new Map<string, { readonly path: string; readonly rank: number }>()
    for (const path of paths) {
      const rank = indexRank(path)
      const directory = directoryOf(path)
      if (rank === null) continue
      if (directory === root) {
        const best = overviews.get(collection)
        if (best === undefined || rank < best.rank || (rank === best.rank && path < best.path)) {
          overviews.set(collection, { path, rank })
        }
      }
      if (!inside(directory)) continue
      const best = ranked.get(directory)
      if (best === undefined || rank < best.rank || (rank === best.rank && path < best.path)) {
        ranked.set(directory, { path, rank })
      }
    }
    return [{ collection, paths, inside, ranked }]
  })

  const generated = new Map<string, C>()
  const indexes = new Map<string, string>()
  const parents = new Map<string, string | null>()
  const folderOf = new Map<string, string>()
  for (const { ranked } of read) {
    for (const [folder, { path }] of ranked) {
      indexes.set(folder, path)
      folderOf.set(path, folder)
    }
  }

  for (const { collection, paths, inside, ranked } of read) {
    // Every folder that holds a document of the collection, at any depth.
    const own = new Set<string>()
    for (const path of paths) {
      for (let folder = directoryOf(path); inside(folder); folder = directoryOf(folder)) {
        if (own.has(folder)) break
        if (ranked.has(folder)) own.add(folder)
        else if (!generated.has(folder) && !indexes.has(folder)) {
          generated.set(folder, collection)
          folderOf.set(generatedFolderPath(folder), folder)
          own.add(folder)
        }
        // A folder another collection has a document for is not this
        // collection's, so the walk carries on above it.
      }
    }

    const documentOf = (folder: string): string =>
      ranked.get(folder)?.path ?? generatedFolderPath(folder)
    const nearest = (start: string): string | null => {
      for (let folder = start; inside(folder); folder = directoryOf(folder)) {
        if (own.has(folder)) return documentOf(folder)
      }
      return null
    }
    for (const path of paths) {
      parents.set(path, nearest(directoryOf(folderOf.get(path) ?? path)))
    }
    for (const folder of own) {
      if (!ranked.has(folder))
        parents.set(generatedFolderPath(folder), nearest(directoryOf(folder)))
    }
  }
  const leading = new Set([...overviews.values()].map(({ path }) => path))
  return { generated, indexes, parents, folderOf, leading }
}

/**
 * The documents of a revision by path, with each folder's path added for the
 * document that stands for it, so a link to `./concepts/tenancy/`, to
 * `./concepts/tenancy`, or to its `README.md` opens the same page (ADR-061).
 * A path a file has is never taken by a folder.
 */
export function withFolderAddresses(
  documents: ReadonlyMap<string, DocumentId>,
): ReadonlyMap<string, DocumentId> {
  const folders = new Map<string, { readonly id: DocumentId; readonly rank: number }>()
  for (const [path, id] of documents) {
    const generated = generatedFolderOf(path)
    // A generated document stands for a folder with no index file at all.
    const rank = generated === null ? indexRank(path) : 2
    if (rank === null) continue
    const folder = generated ?? directoryOf(path)
    const best = folders.get(folder)
    if (best === undefined || rank < best.rank) folders.set(folder, { id, rank })
  }
  if (folders.size === 0) return documents
  const addressed = new Map(documents)
  for (const [folder, { id }] of folders) {
    if (!addressed.has(folder)) addressed.set(folder, id)
  }
  return addressed
}
