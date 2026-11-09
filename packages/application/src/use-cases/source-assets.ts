import { BRAND } from '@quill/brand'
import { sourcePatternMatcher } from '@quill/domain'

import { DIAGRAM_SOURCE_MEDIA_TYPE, DRAWING_MEDIA_TYPE } from './media-types.ts'
import { isDocumentPath } from './source-files.ts'
import type { LayoutPlacer, SourceLayout } from './source-layout.ts'

/**
 * Repository assets (ADR-061, "Repository assets, as content-addressed
 * attachments"): which files of a source are imported as attachments, and
 * what each is declared to be.
 *
 * An asset is a file under one of the manifest's `assets` paths, or an image
 * inside a collection's paths. Either way it is not a document: Markdown is
 * placed as a page, never imported as a file. It goes through the same
 * intake as an upload (ADR-011): its bytes are sniffed against what its name
 * declares, capped, and a picture's metadata is removed before the hash that
 * addresses it is taken.
 */

/** What a file name declares its bytes to be, by extension; checked against the bytes, never believed. */
const DECLARED_TYPES: ReadonlyMap<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['svg', DRAWING_MEDIA_TYPE],
  ['drawio', DIAGRAM_SOURCE_MEDIA_TYPE],
  ['pdf', 'application/pdf'],
])

/** The extensions a picture is drawn from, inside a collection as under `assets`. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'])

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Whether a path names a picture, by its extension. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path))
}

/** The media type a file's name declares; one this platform never accepts when it declares none it knows. */
export function declaredAssetType(path: string): string {
  return DECLARED_TYPES.get(extensionOf(path)) ?? 'application/octet-stream'
}

/** The last segment of a path: what an imported asset is called. */
export function assetFilename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** A test of whether a file of the source is an asset under this layout. */
export function assetMatcher(
  layout: SourceLayout,
  placer: LayoutPlacer,
): (path: string) => boolean {
  const assets = layout.assets.map(sourcePatternMatcher)
  return (path) =>
    !isDocumentPath(path) &&
    (assets.some((matches) => matches(path)) || (isImagePath(path) && placer.place(path) !== null))
}

/**
 * Where a sourced workspace's store keeps its asset map (ADR-061): which
 * attachment each asset path holds, as of each stored revision. The sync job
 * writes it whenever the map changes, before the revision it changes with is
 * published, so the tree of every stored revision carries the map it was
 * synced with, and a revision is rendered with the pictures it had.
 */
export const SOURCE_ASSET_MAP_PATH = `.${BRAND.slug}/source-assets.json`

/** The version of the asset map's document (ADR-033). */
export const SOURCE_ASSET_MAP_VERSION = 1

/** An asset map as its file holds it: paths sorted, so an unchanged map is the same bytes. */
export function writeAssetMap(map: ReadonlyMap<string, string>): string {
  const assets = Object.fromEntries([...map].toSorted(([left], [right]) => (left < right ? -1 : 1)))
  return `${JSON.stringify({ version: SOURCE_ASSET_MAP_VERSION, assets }, null, 2)}\n`
}

/** An asset map read back; null for a file this release cannot read, which renders as if there were none. */
export function readAssetMap(text: string): ReadonlyMap<string, string> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { version, assets } = parsed as { version?: unknown; assets?: unknown }
  if (version !== SOURCE_ASSET_MAP_VERSION || typeof assets !== 'object' || assets === null) {
    return null
  }
  return new Map(
    Object.entries(assets).flatMap(([path, id]) => (typeof id === 'string' ? [[path, id]] : [])),
  )
}
