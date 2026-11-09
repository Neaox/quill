import { isSourceGlob, sourcePatternMatcher, sourcePatternPrefix } from '@quill/domain'
import type { DocumentId, SourceCollectionOrder } from '@quill/domain'

import type { CollectionId } from '../ports/persistence.ts'
import type { SourceCollection } from '../ports/source-sync.ts'
import type { ManifestEntry, UnknownManifestKey } from './source-manifest.ts'
import { SOURCE_MANIFEST_PATH } from './source-manifest.ts'

/**
 * Where a sourced workspace's files go (ADR-061, "Tree, titles and order"):
 * which collection each file is placed in, what is left out, and how a
 * collection orders what does not say where it goes.
 *
 * A layout comes from the source's manifest when the revision being synced
 * has one, and otherwise from the collections in the source's stored
 * settings, so a source configured before it had a manifest keeps syncing
 * as it did. The manifest wins wherever it is present.
 *
 * Its fingerprint is what the sync job compares to tell that the layout
 * changed, which re-plans the whole tree.
 */

/** A collection of the layout: a manifest's, by slug, or the settings', by id. */
export type LayoutCollection = {
  readonly path: string
  readonly order: SourceCollectionOrder
} & (
  | { readonly from: 'manifest'; readonly slug: string; readonly title: string }
  | { readonly from: 'settings'; readonly collectionId: CollectionId }
)

export interface SourceLayout {
  readonly origin: 'manifest' | 'settings'
  readonly collections: readonly LayoutCollection[]
  readonly exclude: readonly string[]
  /** Paths and globs of repository assets, imported as attachments (ADR-061). */
  readonly assets: readonly string[]
  /** Old path to new path: an added file takes the id of the removed file redirected to it. */
  readonly redirects: ReadonlyMap<string, string>
  /** Equal for two layouts that place every file the same way. */
  readonly fingerprint: string
  /** The manifest's keys this release does not read, for the source's admin page. */
  readonly unknownKeys: readonly UnknownManifestKey[]
}

/**
 * How the tree nests a collection's documents, carried in every layout's
 * fingerprint: a tree placed under an earlier way (flat, before folders were
 * documents) is placed again on its next sync, so an existing workspace takes
 * its folders without a new revision of its source (ADR-061).
 */
export const LAYOUT_TREE = 'folders'

/** Whether a recorded fingerprint was placed the way this release nests a tree. */
export function placedAsTree(fingerprint: string): boolean {
  let read: unknown
  try {
    read = JSON.parse(fingerprint)
  } catch {
    return false
  }
  return typeof read === 'object' && read !== null && 'tree' in read && read.tree === LAYOUT_TREE
}

export function layoutFromManifest(
  entry: ManifestEntry,
  unknownKeys: readonly UnknownManifestKey[] = [],
): SourceLayout {
  const collections = entry.collections.map((collection): LayoutCollection => ({
    from: 'manifest',
    ...collection,
  }))
  return {
    origin: 'manifest',
    collections,
    exclude: entry.exclude,
    assets: entry.assets,
    redirects: new Map(entry.redirects),
    fingerprint: JSON.stringify({
      origin: 'manifest',
      tree: LAYOUT_TREE,
      collections: canonical(
        entry.collections.map(({ slug, title, path, order }) => [slug, title, path, order]),
      ),
      exclude: canonical(entry.exclude),
      redirects: canonical(entry.redirects),
      // Only when there are any, so a layout recorded before assets were
      // imported keeps its fingerprint; a change of them re-plans the tree,
      // which imports what they newly name.
      ...(entry.assets.length === 0 ? {} : { assets: canonical(entry.assets) }),
    }),
    unknownKeys,
  }
}

export function layoutFromSettings(settings: readonly SourceCollection[]): SourceLayout {
  // Stored settings are checked plain paths; a trailing slash is read as the
  // directory it names.
  const read = settings.map(({ collectionId, path }) => ({
    collectionId,
    path: path.replace(/\/+$/u, ''),
  }))
  return {
    origin: 'settings',
    collections: read.map((collection): LayoutCollection => ({
      from: 'settings',
      ...collection,
      order: 'title',
    })),
    exclude: [],
    assets: [],
    redirects: new Map(),
    fingerprint: JSON.stringify({
      origin: 'settings',
      tree: LAYOUT_TREE,
      collections: canonical(read.map(({ collectionId, path }) => [collectionId, path])),
    }),
    unknownKeys: [],
  }
}

/** Each entry as text, sorted: a fingerprint that does not depend on the order written. */
function canonical(entries: readonly unknown[]): readonly string[] {
  return entries.map((entry) => JSON.stringify(entry)).toSorted()
}

/**
 * The paths the source is narrowed to for a layout: the manifest, every
 * collection's path, and every asset path. A glob is fetched by the
 * directory in front of it and narrowed again when placed. Excluded paths are
 * left out when placing, not when fetching: the sparse patterns name what to
 * take, never what to leave.
 */
export function layoutPaths(layout: SourceLayout): readonly string[] {
  return [SOURCE_MANIFEST_PATH, ...layout.collections.map(({ path }) => path), ...layout.assets]
}

/** Places files in a layout's collections, compiling each pattern once. */
export interface LayoutPlacer {
  /**
   * The collection a file belongs to: of those whose path covers it, the one
   * with the longest literal directory, so a collection nested inside
   * another's takes its own files; of a glob and the directory it starts
   * with, the glob, which picks some of that directory's files. Null when
   * none covers it or it is excluded.
   */
  place(path: string): LayoutCollection | null
}

export function layoutPlacer(layout: SourceLayout): LayoutPlacer {
  const collections = layout.collections.map((collection) => ({
    collection,
    covers: sourcePatternMatcher(collection.path),
    weight:
      sourcePatternPrefix(collection.path).length * 2 + (isSourceGlob(collection.path) ? 1 : 0),
  }))
  const excluded = layout.exclude.map(sourcePatternMatcher)
  return {
    place(path) {
      if (excluded.some((covers) => covers(path))) return null
      let best: (typeof collections)[number] | null = null
      for (const candidate of collections) {
        if (candidate.covers(path) && (best === null || candidate.weight > best.weight)) {
          best = candidate
        }
      }
      return best?.collection ?? null
    },
  }
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/** What ordering one document of a collection needs to know about it. */
export interface Orderable {
  readonly id: DocumentId
  /** Its front matter's `order`, when it has one. */
  readonly order: number | null
  readonly title: string
  readonly path: string
  /** When it first appeared in the source. */
  readonly createdAt: Date
}

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

const RULES: Readonly<
  Record<SourceCollectionOrder, (left: Orderable, right: Orderable) => number>
> = {
  title: (left, right) => COLLATOR.compare(left.title, right.title),
  filename: (left, right) => COLLATOR.compare(fileName(left.path), fileName(right.path)),
  newest: (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  oldest: (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
}

/**
 * Each document's sort key (ADR-049), projected from the collection's order
 * (ADR-061): a document whose front matter has an `order` keeps it as its
 * key, so it comes first; the rest follow it in the collection's rule, on the
 * keys after the largest `order`. The tree, its pages and the public site
 * then read one order and need no mode of their own.
 */
export function projectSortKeys<T extends Orderable>(
  documents: readonly T[],
  rule: SourceCollectionOrder,
): readonly { readonly item: T; readonly sortKey: number }[] {
  const placed = documents.flatMap((item) =>
    item.order === null ? [] : [{ item, sortKey: item.order }],
  )
  const highest = Math.max(0, ...placed.map(({ sortKey }) => sortKey))
  const compare = RULES[rule]
  const rest = documents
    .filter((document) => document.order === null)
    .toSorted(
      (left, right) =>
        compare(left, right) ||
        COLLATOR.compare(left.path, right.path) ||
        left.id.localeCompare(right.id, 'en'),
    )
    .map((item, index) => ({ item, sortKey: highest + index + 1 }))
  return [...placed, ...rest]
}

/**
 * The largest `order` read. Sort keys are stored as 32-bit integers, and the
 * documents without an `order` are numbered after the largest, so there is
 * room for a collection of any size above it.
 */
export const MAX_FRONT_MATTER_ORDER = 1_000_000_000

/** A front matter `order` the tree can sort by: a whole number within the bound, or nothing. */
export function readOrder(value: unknown): number | null {
  return Number.isInteger(value) && Math.abs(Number(value)) <= MAX_FRONT_MATTER_ORDER
    ? Number(value)
    : null
}
