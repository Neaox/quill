import { defaultForgeViewTemplate, forgeViewUrl } from '@quill/domain'
import type { DocumentId, RevisionId } from '@quill/domain'

import type { ContentStore } from '../ports/content-store.ts'
import type { ResolvedDestination } from '../ports/document-format.ts'
import type { DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { SourceLinkSettings } from '../ports/source-sync.ts'
import { attachmentUrl } from './attachments.ts'
import { documentUrl } from './document-path.ts'
import { isImagePath, readAssetMap, SOURCE_ASSET_MAP_PATH } from './source-assets.ts'
import { withFolderAddresses } from './source-folders.ts'
import { compareSiblings } from './sibling-order.ts'
import { followRedirects, readSourceAddresses } from './source-removal.ts'

/**
 * Relative links in a sourced document, resolved at render (ADR-061,
 * "Relative links, resolved at render").
 *
 * A file read from a repository links to its neighbours the way the
 * repository does: `../adr/0012-auth.md#token-rotation`. The stored copy is
 * never rewritten, so a compare shows only what the source changed; instead
 * each link is resolved against the document's own path and the documents of
 * the revision being rendered, and the answer is part of the render input,
 * so the cache key covers it and the cached body is the same for every
 * reader (ADR-031). Whether one reader may follow a link to another document
 * is decided per request, after the cache (`surface-links.ts`).
 *
 * A link that names a document of the revision goes to its canonical address
 * and the heading its fragment names. Any other path in the repository goes
 * to the forge at the commit the page was synced from, or is shown as its
 * words when the source asks for that or no forge address is known. A path
 * that climbs out of the repository leads nowhere and is shown as words.
 */

/** What every rendered heading's id starts with (`@quill/markdown`'s `HEADING_ID_PREFIX`). */
export const HEADING_ANCHOR_PREFIX = 'user-content-'

const TEXT: ResolvedDestination = { kind: 'text' }
const SCHEME = /^[a-z][a-z0-9+.-]*:/iu

/** An inline destination: `](…)`, in angle brackets or bare with balanced parentheses. */
const INLINE_DESTINATION = /\]\(\s*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+))/gu
/** A reference definition's destination: `[label]: …` at the start of a line. */
const DEFINITION_DESTINATION = /^ {0,3}\[(?:[^\]\\\n]|\\.)+\]:[ \t]*(?:<([^<>\n]*)>|(\S+))/gmu
/** A backslash escape, which the parser removes from a destination. */
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/gu

/**
 * Whether a destination is relative to the file it is written in: not an
 * address with a scheme, not one from the root or another host, and not a
 * section of the same page.
 */
export function isRelativeDestination(url: string): boolean {
  return url !== '' && !SCHEME.test(url) && !/^[/\\#?]/u.test(url)
}

/**
 * Every relative destination a piece of Markdown may hold, as the parser
 * will read it, without parsing it: so the links can be resolved *before*
 * the render that needs them.
 *
 * Deliberately generous, like `linkedDocumentReferences`: a destination
 * inside a code block is found too, which costs one entry in the render
 * input and never a wrong body, because only a link the parser finds is
 * ever drawn from it.
 */
export function relativeDestinations(markdown: string): ReadonlySet<string> {
  const found = new Set<string>()
  for (const pattern of [INLINE_DESTINATION, DEFINITION_DESTINATION]) {
    for (const [, bracketed, bare] of markdown.matchAll(pattern)) {
      /* v8 ignore next -- each pattern's alternatives capture one group or the other. */
      const url = (bracketed ?? bare ?? '').replaceAll(ESCAPED_PUNCTUATION, '$1')
      if (isRelativeDestination(url)) found.add(url)
    }
  }
  return found
}

/** A relative destination's path in the repository, and the section it names. */
export interface RepositoryTarget {
  readonly path: string
  readonly fragment: string | null
}

/**
 * Where a relative destination written in the file at `from` points, as the
 * forge resolves it: against the file's directory, `.` and `..` walked, a
 * query dropped, the path percent-decoded. Null when it climbs out of the
 * repository or does not decode: it names nothing there.
 */
export function repositoryTarget(from: string, url: string): RepositoryTarget | null {
  const hash = url.indexOf('#')
  const fragment = hash === -1 || hash === url.length - 1 ? null : url.slice(hash + 1)
  const beforeHash = hash === -1 ? url : url.slice(0, hash)
  const query = beforeHash.indexOf('?')
  const raw = query === -1 ? beforeHash : beforeHash.slice(0, query)
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const segments = from.split('/').slice(0, -1)
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return { path: segments.join('/'), fragment }
}

/** What links in one document are resolved against. */
export interface SourceLinkContext {
  /** The document's own path in the repository. */
  readonly path: string
  /**
   * The documents of the revision being rendered, by their paths, and each
   * folder's by the folder's path (`withFolderAddresses`).
   */
  readonly documents: ReadonlyMap<string, DocumentId>
  /** The forge's address for a repository path at the synced commit; null to show such links as text. */
  readonly outside: ((path: string) => string) | null
  /** The attachment each imported asset's path holds (ADR-061, "Repository assets"). */
  readonly assets?: ReadonlyMap<string, string> | undefined
}

/** The section of a rendered document a fragment written against the forge names. */
function headingAnchor(fragment: string): string {
  return fragment.startsWith(HEADING_ANCHOR_PREFIX)
    ? fragment
    : `${HEADING_ANCHOR_PREFIX}${fragment}`
}

/** What a document's relative destinations resolved to. */
export interface SourceLinks {
  /** As links: to documents, the forge, or words. */
  readonly resolved: ReadonlyMap<string, ResolvedDestination>
  /**
   * As images: to the attachment an imported asset became, or the image's
   * alternative text for a picture that was not imported (refused, missing,
   * or outside the repository). A destination that names no picture has none.
   */
  readonly images: ReadonlyMap<string, ResolvedDestination>
  /** The documents the links name. */
  readonly targets: ReadonlySet<DocumentId>
  /** The attachments the images show, so a drawing among them is drawn (ADR-036). */
  readonly attachments: ReadonlySet<string>
}

/** Whether a destination as written names a picture, by its path's extension. */
function namesImage(url: string): boolean {
  return isImagePath(url.split(/[?#]/u, 1).join(''))
}

/** Each destination's resolution, and the documents and attachments they name. */
export function resolveSourceLinks(
  urls: Iterable<string>,
  context: SourceLinkContext,
): SourceLinks {
  const resolved = new Map<string, ResolvedDestination>()
  const images = new Map<string, ResolvedDestination>()
  const targets = new Set<DocumentId>()
  const attachments = new Set<string>()
  for (const url of urls) {
    const target = repositoryTarget(context.path, url)
    if (target === null) {
      resolved.set(url, TEXT)
      if (namesImage(url)) images.set(url, TEXT)
      continue
    }
    const asset = context.assets?.get(target.path)
    if (asset !== undefined) {
      attachments.add(asset)
      images.set(url, { kind: 'href', href: attachmentUrl(asset) })
    } else if (isImagePath(target.path)) {
      images.set(url, TEXT)
    }
    const section = target.fragment
    const id = context.documents.get(target.path)
    if (id !== undefined) {
      targets.add(id)
      const anchor = section === null ? '' : `#${headingAnchor(section)}`
      resolved.set(url, { kind: 'href', href: `${documentUrl(id)}${anchor}` })
    } else if (context.outside !== null) {
      const anchor = section === null ? '' : `#${section}`
      resolved.set(url, { kind: 'href', href: `${context.outside(target.path)}${anchor}` })
    } else {
      resolved.set(url, TEXT)
    }
  }
  return { resolved, images, targets, attachments }
}

/** The forge's address for a repository path at a commit, or null when links outside are text. */
export function outsideLinks(
  settings: SourceLinkSettings & { readonly remote: string },
  commit: string | null,
): ((path: string) => string) | null {
  if (settings.outsideLinks === 'text' || commit === null) return null
  const template = settings.viewTemplate ?? defaultForgeViewTemplate(settings.remote)
  return template === null ? null : (path) => forgeViewUrl(template, commit, path)
}

/** Where a published document sits in the revision being rendered. */
export interface SourcePlace {
  readonly path: string
  readonly revision: RevisionId
  /**
   * True for the published head, whose links to the forge go to the commit
   * the workspace is synced to; false for an older revision, whose go to
   * that revision's own commit.
   */
  readonly head: boolean
}

export interface SourceLinksDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
}

const NONE: SourceLinks = {
  resolved: new Map(),
  images: new Map(),
  targets: new Set(),
  attachments: new Set(),
}

/**
 * The relative links of a document at a place, resolved; none for a
 * document of a native workspace, or one with no relative link.
 *
 * The source's settings are read only when the text holds a relative
 * destination, and the revision's documents only when the workspace is
 * sourced, so a native body costs nothing it did not cost before.
 */
export async function sourceLinksAt(
  deps: SourceLinksDependencies,
  document: DocumentRow,
  markdown: string,
  place: SourcePlace,
): Promise<SourceLinks> {
  const urls = relativeDestinations(markdown)
  if (urls.size === 0) return NONE
  const { repos } = deps.uow
  const settings = await repos.workspaceSources.find(document.workspaceId)
  if (settings === null) return NONE
  const paths = [
    ...new Set([...urls].flatMap((url) => repositoryTarget(place.path, url)?.path ?? [])),
  ]
  const [tree, commit, assets] = await Promise.all([
    deps.contentStore.listTree(document.workspaceId, place.revision),
    syncedCommit(deps.uow, document, place),
    assetsAt(deps, document, place, paths),
  ])
  const held = withFolderAddresses(
    new Map(
      tree.flatMap((entry) =>
        entry.documentId === undefined ? [] : [[entry.path, entry.documentId] as const],
      ),
    ),
  )
  const documents = paths.every((path) => held.has(path))
    ? held
    : await withRemovedPaths(deps.uow, document, paths, held)
  return resolveSourceLinks(urls, {
    path: place.path,
    documents,
    outside: outsideLinks(settings, commit),
    assets,
  })
}

/**
 * The revision's documents with the paths it does not hold that the source
 * once did (ADR-061, ADR-046): a path the manifest redirects leads to the
 * page its redirect names, and a removed path to its archived page, which
 * says it was removed rather than sending the reader to a forge page that is
 * not there. Read only when a link names a path the revision lacks.
 */
async function withRemovedPaths(
  uow: UnitOfWork,
  document: DocumentRow,
  paths: readonly string[],
  held: ReadonlyMap<string, DocumentId>,
): Promise<ReadonlyMap<string, DocumentId>> {
  const addresses = await readSourceAddresses(uow, document)
  const documents = new Map(held)
  let landings: Promise<ReadonlyMap<string, DocumentId>> | undefined
  for (const path of paths) {
    if (documents.has(path)) continue
    const row = addresses.paths.get(path)
    const target = followRedirects(path, addresses) ?? row?.documentId
    if (target !== undefined) {
      documents.set(path, target)
      continue
    }
    const collection = addresses.roots.get(path)
    if (collection === undefined) continue
    landings ??= collectionLandings(uow, document)
    const landing = (await landings).get(collection)
    if (landing !== undefined) documents.set(path, landing)
  }
  return documents
}

/**
 * Where a link to a collection's own directory leads when no file stands for
 * the directory (ADR-061, amendment "a link to a collection's directory"):
 * the collection's first page, the one its sidebar list opens with. Its
 * `README.md`, where it has one, is already that directory's document.
 */
async function collectionLandings(
  uow: UnitOfWork,
  document: DocumentRow,
): Promise<ReadonlyMap<string, DocumentId>> {
  const rows = await uow.repos.documents.listByWorkspace(document.workspaceId)
  const landings = new Map<string, DocumentId>()
  for (const row of rows
    .filter((each) => each.parentId === null && each.status !== 'archived')
    .toSorted(compareSiblings)) {
    const { collectionId } = row
    if (collectionId !== null && !landings.has(collectionId)) landings.set(collectionId, row.id)
  }
  return landings
}

/**
 * The attachments these paths held at the revision being rendered (ADR-061):
 * from the asset map the store keeps with each revision, so an older
 * revision shows the pictures it had. A revision stored before the map was
 * kept there falls back to the map as it is now.
 */
async function assetsAt(
  deps: SourceLinksDependencies,
  document: DocumentRow,
  place: SourcePlace,
  paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const file = await deps.contentStore.readFile(
    document.workspaceId,
    SOURCE_ASSET_MAP_PATH,
    place.revision,
  )
  const stored = file === null ? null : readAssetMap(file.text)
  if (stored !== null) return stored
  const rows = await deps.uow.repos.sourceAssets.listByPaths(document.workspaceId, paths)
  return new Map(rows.map((row) => [row.path, row.attachmentId]))
}

/** The source revision a place was synced from, or null when none is recorded. */
async function syncedCommit(
  uow: UnitOfWork,
  document: DocumentRow,
  place: SourcePlace,
): Promise<string | null> {
  if (place.head) {
    const state = await uow.repos.sourceSyncState.find(document.workspaceId)
    return state?.lastSyncedRevision ?? null
  }
  const row = await uow.repos.revisions.findForDocument(document.id, place.revision)
  return row?.sourceRevision ?? null
}
