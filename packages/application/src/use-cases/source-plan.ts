import { sourcePatternPrefix } from '@quill/domain'

import { ExternalSourceError } from '../ports/external-source.ts'
import type {
  ExternalSource,
  SourceFile,
  SourceFileContent,
  SourceRevisionId,
} from '../ports/external-source.ts'
import type { SourceCollection } from '../ports/source-sync.ts'
import { decodeUtf8, isDocumentPath } from './source-files.ts'
import { generatedFolderOf } from './source-folders.ts'
import type { FolderPlanCollection } from './source-folders.ts'
import { layoutFromManifest, layoutFromSettings } from './source-layout.ts'
import type { LayoutCollection, LayoutPlacer, SourceLayout } from './source-layout.ts'
import {
  parseSourceManifest,
  selectManifestEntry,
  SOURCE_MANIFEST_PATH,
} from './source-manifest.ts'
import type { ManifestEntry, ManifestProblem, SourceManifest } from './source-manifest.ts'

/**
 * The decisions the sync job makes about a revision's files before it writes
 * anything (ADR-061): which layout the revision is placed by, whether a file
 * is a document, which collection takes it, and whether its contents can be
 * stored. The sync job and the preview both make them here, so a preview can
 * never place a file where the sync would not.
 */

/** A document of the source: a Markdown file, never at a path a folder's generated document takes. */
export function isSourceDocument(path: string): boolean {
  return isDocumentPath(path) && generatedFolderOf(path) === null
}

/** File contents by id, read in one request: a revision's files are wanted together. */
export async function readSourceContents(
  source: ExternalSource,
  files: readonly SourceFile[],
): Promise<Map<string, SourceFileContent>> {
  const contents = new Map<string, SourceFileContent>()
  if (files.length === 0) return contents
  for await (const content of source.readFiles(files.map((file) => file.fileId))) {
    contents.set(content.fileId, content)
  }
  return contents
}

/** How a revision's layout was read, with the manifest when there was one that parsed. */
export type LayoutReading =
  | {
      readonly ok: true
      readonly layout: SourceLayout
      /** Null when the revision has no manifest, and the settings place its files. */
      readonly manifest: SourceManifest | null
      /** The manifest's entry the layout is read from; null when the settings place the files. */
      readonly entry: ManifestEntry | null
    }
  | {
      readonly ok: false
      readonly problem: ManifestProblem
      /** The manifest when it parsed but names no entry for this workspace. */
      readonly manifest: SourceManifest | null
    }

/**
 * The layout a revision is placed by: its manifest's entry for this
 * workspace when it has a manifest, and otherwise the collections of the
 * source's settings. A manifest that cannot be read, or that describes
 * several workspaces and none by the entry asked for, is a problem with the
 * line it is on.
 */
export async function readLayoutAt(
  source: ExternalSource,
  revision: SourceRevisionId,
  options: {
    readonly collections: readonly SourceCollection[]
    /** The manifest entry to read when the manifest describes several workspaces. */
    readonly entry: string
  },
): Promise<LayoutReading> {
  const file = await source.file(revision, SOURCE_MANIFEST_PATH)
  if (file === null) {
    return {
      ok: true,
      layout: layoutFromSettings(options.collections),
      manifest: null,
      entry: null,
    }
  }
  if (file.kind === 'symbolic-link') {
    return unreadable('it is a symbolic link, which is never followed.')
  }
  const content = (await readSourceContents(source, [file])).get(file.fileId)
  if (content === undefined) {
    throw new ExternalSourceError('file-missing', `The source did not return ${file.path}.`)
  }
  if (content.kind === 'too-large') return unreadable('it is larger than a source file may be.')
  const text = decodeUtf8(content.bytes)
  if (text === null) return unreadable('it is not UTF-8.')
  const parsed = parseSourceManifest(text)
  if (!parsed.ok) return { ok: false, problem: parsed.problem, manifest: null }
  const entry = selectManifestEntry(parsed.manifest, options.entry)
  if (!entry.ok) return { ok: false, problem: entry.problem, manifest: parsed.manifest }
  return {
    ok: true,
    layout: layoutFromManifest(entry.entry, parsed.manifest.unknownKeys),
    manifest: parsed.manifest,
    entry: entry.entry,
  }
}

function unreadable(message: string): LayoutReading {
  return { ok: false, problem: { line: null, message }, manifest: null }
}

/** What becomes of a document file under a layout, before its contents are read. */
export type DocumentVerdict =
  | { readonly kind: 'placed'; readonly collection: LayoutCollection }
  /** The layout leaves it out: an `exclude` pattern covers it, or no collection's path does. */
  | { readonly kind: 'left-out'; readonly reason: 'excluded' | 'outside' }
  /** A collection would take it, but it cannot be stored. */
  | { readonly kind: 'refused'; readonly reason: 'symbolic-link' }

export function acceptSourceDocument(file: SourceFile, placer: LayoutPlacer): DocumentVerdict {
  const placement = placer.placement(file.path)
  if (placement.kind !== 'placed') return { kind: 'left-out', reason: placement.kind }
  if (file.kind === 'symbolic-link') return { kind: 'refused', reason: 'symbolic-link' }
  return { kind: 'placed', collection: placement.collection }
}

/** A document's text, or why its contents cannot be stored. */
export type DocumentContents =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'refused'; readonly reason: 'too-large' | 'not-utf8' }

export function readSourceDocument(content: SourceFileContent): DocumentContents {
  if (content.kind === 'too-large') return { kind: 'refused', reason: 'too-large' }
  const text = decodeUtf8(content.bytes)
  return text === null ? { kind: 'refused', reason: 'not-utf8' } : { kind: 'text', text }
}

/**
 * Each collection of a layout as the folder plan reads it: the directory its
 * documents are relative to is the literal one in front of its path.
 */
export function folderRoots<C extends string>(
  layout: SourceLayout,
  idOf: (collection: LayoutCollection) => C | undefined,
): readonly FolderPlanCollection<C>[] {
  return layout.collections.flatMap((collection) => {
    const id = idOf(collection)
    /* v8 ignore next -- every collection of a layout is resolved with it. */
    if (id === undefined) return []
    return [{ collection: id, root: sourcePatternPrefix(collection.path) }]
  })
}
