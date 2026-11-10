import type { DocumentId, SourceCollectionOrder } from '@quill/domain'

import type { DocumentFormat, DocumentInspection, ExtractedLink } from '../ports/document-format.ts'
import { ExternalSourceError } from '../ports/external-source.ts'
import type {
  ExternalSource,
  SourceChange,
  SourceFile,
  SourceFileContent,
  SourceRevisionId,
} from '../ports/external-source.ts'
import type { CollectionId } from '../ports/persistence.ts'
import type { BrokenSourceLink, RefusedSourceFile, SourcePathRow } from '../ports/source-sync.ts'
import { receiveFile } from './attachments.ts'
import type { AttachmentDependencies, Received } from './attachments.ts'
import { declaredAssetType } from './source-assets.ts'
import { titleFromPath } from './source-files.ts'
import {
  directoryOf,
  folderTitle,
  generatedFolderMarkdown,
  generatedFolderOf,
  generatedFolderPath,
  planFolders,
} from './source-folders.ts'
import type { FolderPlan } from './source-folders.ts'
import { byCodePoint, LEADING_ORDER, projectSortKeys, readOrder } from './source-layout.ts'
import type { LayoutCollection, LayoutPlacer, SourceLayout } from './source-layout.ts'
import { isRelativeDestination, repositoryTarget } from './source-links.ts'
import {
  acceptSourceDocument,
  folderRoots,
  isSourceDocument,
  readSourceContents,
  readSourceDocument,
} from './source-plan.ts'

/**
 * What one revision of a source does to a workspace's documents (ADR-061),
 * decided before anything is written: which files are stored, placed again,
 * moved or archived, under which ids, and where each folder's document is.
 *
 * The sync job writes exactly what this decides, and the head plan
 * (`source-head-plan.ts`, ADR-062) asks the same question of a workspace
 * that holds nothing yet, so the two cannot place a file differently. The
 * decisions only read the source and the path map; the one thing they make
 * is the id of a document seen for the first time, which the caller mints.
 */

/** What one document does in a revision, once the source's changes are read. */
export type DocumentEdit =
  | {
      readonly kind: 'write'
      readonly documentId: DocumentId
      readonly collectionId: CollectionId
      readonly path: string
      readonly fromPath: string | null
      readonly markdown: string
      readonly title: string
      readonly order: number | null
      /** The repository paths its relative images point at: who may see an asset (ADR-061). */
      readonly images: readonly string[]
      /** Its relative links, and the repository path each names: what the link check reads. */
      readonly links: readonly RelativeLinkTarget[]
    }
  /** Unchanged in the store, placed again in the tree: a re-plan's. */
  | {
      readonly kind: 'place'
      readonly documentId: DocumentId
      readonly collectionId: CollectionId
      readonly path: string
      readonly title: string
      readonly order: number | null
    }
  | { readonly kind: 'archive'; readonly documentId: DocumentId; readonly path: string }

export type WriteEdit = Extract<DocumentEdit, { kind: 'write' }>
/** Where a revision leaves each folder's document, and what each document nests under. */
export type Folders = FolderPlan<CollectionId>
/** An edit the store sees: a write, a move or a delete. */
export type ContentEdit = Extract<DocumentEdit, { kind: 'write' | 'archive' }>
export type PlacedEdit = Extract<DocumentEdit, { kind: 'write' | 'place' }>

/** What deciding a revision reads, and the one thing it makes. */
export interface RevisionPlanContext {
  readonly source: ExternalSource
  readonly format: Pick<DocumentFormat, 'stampIdentity' | 'inspect'>
  /** The id of a document seen for the first time, at this path. */
  readonly mintDocumentId: (path: string) => DocumentId
  /** The layout's placer, compiled once per layout. */
  readonly placer: (layout: SourceLayout) => LayoutPlacer
  /**
   * The files not stored, by path. A revision lists the files it refuses
   * and clears those it stores or removes; earlier entries are kept.
   */
  readonly refused: Map<string, RefusedSourceFile>
  /**
   * Inspects many documents at once, in the order given (`DocumentWork`):
   * on a pool of threads on the server. One at a time with `format` when
   * absent.
   */
  readonly inspectAll?: (markdowns: readonly string[]) => Promise<readonly DocumentInspection[]>
}

/** A file the revision stores or places, before its contents are read. */
interface Wanted {
  readonly file: SourceFile
  readonly fromPath: string | null
  /** Already stored as it is: only its place in the tree is decided again. */
  readonly placeOnly: boolean
}

/**
 * The source's changes as document edits: ids minted at first sight,
 * contents read and stamped, each file placed in its collection. A re-plan
 * also places every other file of the revision again, adds those the
 * layout now takes in, and archives those it leaves out.
 */
export async function planRevisionEdits(
  context: RevisionPlanContext,
  input: {
    readonly changes: readonly SourceChange[]
    readonly revision: SourceRevisionId
    readonly paths: ReadonlyMap<string, SourcePathRow>
    readonly layout: SourceLayout
    readonly replan: boolean
    /** The workspace's collection for each of the layout's. */
    readonly ids: ReadonlyMap<LayoutCollection, CollectionId>
  },
): Promise<{ readonly edits: readonly DocumentEdit[]; readonly folders: Folders }> {
  const { revision, paths, layout } = input
  const changes = withRedirects(input.changes, layout.redirects, paths)
  const live = (path: string): SourcePathRow | null => {
    const row = paths.get(path)
    return row === undefined || row.archivedAt !== null ? null : row
  }
  const wanted: Wanted[] = []
  const archived: DocumentEdit[] = []
  const archive = (path: string): void => {
    context.refused.delete(path)
    // A folder's generated document leaves with its folder, never with a file.
    if (generatedFolderOf(path) !== null) return
    const row = live(path)
    if (row !== null && !archived.some((edit) => edit.path === path)) {
      archived.push({ kind: 'archive', documentId: row.documentId, path })
    }
  }

  for (const change of changes) {
    if (change.kind === 'removed') {
      archive(change.path)
    } else if (change.kind === 'renamed') {
      context.refused.delete(change.fromPath)
      const from = isSourceDocument(change.fromPath) ? live(change.fromPath) : null
      if (!isSourceDocument(change.file.path)) archive(change.fromPath)
      else {
        wanted.push({
          file: change.file,
          fromPath: from === null ? null : change.fromPath,
          placeOnly: false,
        })
      }
    } else if (isSourceDocument(change.file.path)) {
      wanted.push({ file: change.file, fromPath: null, placeOnly: false })
    }
  }
  if (input.replan) await replanned(context, revision, changes, wanted, archive, paths)

  const vacated = new Set(wanted.flatMap(({ fromPath }) => (fromPath === null ? [] : [fromPath])))
  // A file that cannot be stored is listed, and a document renamed into
  // one leaves its old path rather than staying where the source no longer
  // has it. A file the layout leaves out is not stored, and leaves.
  const { ids } = input
  const accepted: (Wanted & { readonly collectionId: CollectionId })[] = []
  for (const item of wanted) {
    const verdict = accept(context, item.file, revision, layout, ids)
    if (verdict === 'unplaced') {
      context.refused.delete(item.file.path)
      archive(item.fromPath ?? item.file.path)
    } else if (verdict === 'refused') {
      if (item.fromPath !== null) archive(item.fromPath)
    } else {
      accepted.push({ ...item, collectionId: verdict.collectionId })
    }
  }
  const contents = await readSourceContents(
    context.source,
    accepted.map(({ file }) => file),
  )
  // Each file's text and id first, then every text inspected together, so a
  // pool can read them at once; the edits are built in the files' order.
  const stamped: (Wanted & {
    readonly collectionId: CollectionId
    readonly documentId: DocumentId
    readonly markdown: string
  })[] = []
  for (const item of accepted) {
    const { file, fromPath } = item
    const markdown = decode(context, file, contents, revision)
    if (markdown === null) {
      if (fromPath !== null) archive(fromPath)
      continue
    }
    // A path a rename leaves in this revision keeps no claim on its id: the
    // id went with the renamed file.
    const known = vacated.has(file.path) ? undefined : paths.get(file.path)
    const documentId =
      (fromPath === null ? null : live(fromPath))?.documentId ??
      known?.documentId ??
      context.mintDocumentId(file.path)
    stamped.push({
      ...item,
      documentId,
      markdown: context.format.stampIdentity(markdown, documentId),
    })
  }
  const texts = stamped.map(({ markdown }) => markdown)
  // One parse for everything the revision needs to know of each file.
  const inspections =
    context.inspectAll === undefined
      ? texts.map((text) => context.format.inspect(text))
      : await context.inspectAll(texts)
  const placed: PlacedEdit[] = []
  for (const [
    index,
    { file, fromPath, collectionId, placeOnly, documentId, markdown },
  ] of stamped.entries()) {
    const inspection = inspections[index]
    /* v8 ignore next -- an inspection answers every text it is given. */
    if (inspection === undefined) throw new Error(`No inspection for ${file.path}.`)
    const { view, links } = inspection
    const title = view.title ?? titleFromPath(file.path)
    const order = readOrder(view.frontMatter['order'])
    placed.push(
      placeOnly
        ? { kind: 'place', documentId, collectionId, path: file.path, title, order }
        : {
            kind: 'write',
            documentId,
            collectionId,
            path: file.path,
            fromPath,
            markdown,
            title,
            order,
            images: imagePaths(file.path, links),
            links: relativeLinkTargetsOf(file.path, links),
          },
    )
    context.refused.delete(file.path)
  }
  const folders = planFolderEdits(context, { ...input, ids, placed, archived })
  // Moves first, so a path a rename leaves is free for a file added there in
  // the same revision.
  const moves = placed.filter((edit) => edit.kind === 'write' && edit.fromPath !== null)
  const rest = placed.filter((edit) => edit.kind !== 'write' || edit.fromPath === null)
  return { edits: [...archived, ...moves, ...rest], folders }
}

/**
 * Folders as documents (ADR-061, `source-folders.ts`): each folder's
 * document as the revision leaves the tree, added to the revision's edits.
 *
 * A folder's document keeps its id while the folder has one, whichever
 * file stands for it:
 * - a folder whose generated document gains an index file gives the file
 *   that document's id, so its address and history carry on;
 * - a folder whose index file is removed while it still holds documents
 *   keeps the index's document, now generated, in its place;
 * - a renamed folder's generated document follows the files renamed out of
 *   it, as a renamed index file follows its rename.
 * A generated document whose folder holds nothing any more is archived like
 * a removed file, and comes back with its id if the folder does.
 */
function planFolderEdits(
  context: RevisionPlanContext,
  input: {
    readonly layout: SourceLayout
    readonly ids: ReadonlyMap<LayoutCollection, CollectionId>
    readonly paths: ReadonlyMap<string, SourcePathRow>
    readonly replan: boolean
    /** The revision's documents written or placed; an index file may take its folder's id. */
    readonly placed: PlacedEdit[]
    /** The revision's archives; an index file that leaves may stay as its folder's document. */
    readonly archived: DocumentEdit[]
  },
): Folders {
  const { layout, ids, paths, placed, archived } = input
  const placer = context.placer(layout)
  const roots = folderRoots(layout, (collection) => ids.get(collection))
  const collectionOf = (path: string): CollectionId | null => {
    const collection = placer.place(path)
    if (collection === null) return null
    const id = ids.get(collection)
    /* v8 ignore next -- every collection of a layout is resolved with it. */
    if (id === undefined) throw new Error(`No collection resolved for ${collection.path}.`)
    return id
  }

  // The tree's documents before the revision, and after it.
  const before = new Map<string, CollectionId>()
  const standing = new Map<string, SourcePathRow>()
  for (const row of paths.values()) {
    if (row.archivedAt !== null) continue
    const folder = generatedFolderOf(row.path)
    if (folder !== null) {
      standing.set(folder, row)
      continue
    }
    const collection = collectionOf(row.path)
    if (collection !== null) before.set(row.path, collection)
  }
  const after = new Map(before)
  const leaving = new Set(archived.map(({ path }) => path))
  for (const path of leaving) after.delete(path)
  for (const edit of placed) {
    if (edit.kind === 'write' && edit.fromPath !== null) after.delete(edit.fromPath)
    after.set(edit.path, edit.collectionId)
  }
  const toPlan = (documents: ReadonlyMap<string, CollectionId>) =>
    planFolders(
      [...documents].map(([path, collection]) => ({ path, collection })),
      roots,
    )
  const previous = toPlan(before)
  const plan = toPlan(after)

  // The documents that stood for a folder and no longer do, by the folder:
  // each gives its id to its folder's next document, if the folder has one.
  const vacant = new Map<string, { readonly documentId: DocumentId; readonly path: string }>()
  for (const [folder, row] of standing) {
    if (!plan.generated.has(folder)) vacant.set(folder, row)
  }
  for (const [folder, path] of previous.indexes) {
    const row = paths.get(path)
    if (row !== undefined && leaving.has(path) && !vacant.has(folder)) vacant.set(folder, row)
  }
  // Which folder each folder was, where the revision renamed files out of one into another.
  const renamedFrom = new Map<string, string>()
  for (const edit of placed) {
    if (edit.kind !== 'write' || edit.fromPath === null) continue
    let from = directoryOf(edit.fromPath)
    let to = directoryOf(edit.path)
    // A walk that reaches the root on one side stops at the next step: the
    // root's name is no folder's.
    while (from !== to) {
      if (!renamedFrom.has(to)) renamedFrom.set(to, from)
      if (from.slice(from.lastIndexOf('/') + 1) !== to.slice(to.lastIndexOf('/') + 1)) break
      from = directoryOf(from)
      to = directoryOf(to)
    }
  }
  const take = (folder: string) => {
    for (const candidate of [folder, renamedFrom.get(folder)]) {
      if (candidate === undefined) continue
      const found = vacant.get(candidate)
      if (found === undefined) continue
      vacant.delete(candidate)
      // An index file that stays as its folder's document is not archived.
      const archivedAt = archived.findIndex((edit) => edit.path === found.path)
      if (archivedAt !== -1) archived.splice(archivedAt, 1)
      return found
    }
    return null
  }

  // An index file new to the tree takes the id of the document its folder had.
  const placedAt = new Map(placed.map((edit, index) => [edit.path, index]))
  for (const [folder, path] of plan.indexes) {
    const at = placedAt.get(path) ?? -1
    const edit = placed[at]
    if (edit?.kind !== 'write' || edit.fromPath !== null || paths.get(path)?.archivedAt === null) {
      continue
    }
    const found = take(folder)
    if (found === null) continue
    placed[at] = {
      ...edit,
      documentId: found.documentId,
      fromPath: found.path,
      markdown: context.format.stampIdentity(edit.markdown, found.documentId),
    }
  }

  // A folder with no index file has a document Quill writes.
  for (const [folder, collectionId] of plan.generated) {
    const path = generatedFolderPath(folder)
    const title = folderTitle(folder)
    const row = standing.get(folder)
    if (row !== undefined) {
      if (input.replan) {
        placed.push({
          kind: 'place',
          documentId: row.documentId,
          collectionId,
          path,
          title,
          order: null,
        })
      }
      continue
    }
    const found = take(folder)
    const documentId =
      found?.documentId ?? paths.get(path)?.documentId ?? context.mintDocumentId(path)
    placed.push({
      kind: 'write',
      documentId,
      collectionId,
      path,
      fromPath: found?.path ?? null,
      markdown: context.format.stampIdentity(generatedFolderMarkdown(folder), documentId),
      title,
      order: null,
      images: [],
      links: [],
    })
  }

  // A generated document whose folder holds nothing any more leaves.
  for (const row of vacant.values()) {
    if (generatedFolderOf(row.path) !== null) {
      archived.push({ kind: 'archive', documentId: row.documentId, path: row.path })
    }
  }
  return plan
}

/**
 * A re-plan reads the revision's whole tree: a file the changes did not
 * name is added when the workspace does not hold it, and placed again when
 * it does; a document whose file is gone from the tree leaves.
 */
async function replanned(
  context: RevisionPlanContext,
  revision: SourceRevisionId,
  changes: readonly SourceChange[],
  wanted: Wanted[],
  archive: (path: string) => void,
  paths: ReadonlyMap<string, SourcePathRow>,
): Promise<void> {
  const handled = new Set(changes.flatMap(changedPaths))
  const present = new Set<string>()
  for await (const file of context.source.files(revision)) {
    present.add(file.path)
    if (handled.has(file.path) || !isSourceDocument(file.path)) continue
    const held = paths.get(file.path)?.archivedAt === null
    wanted.push({ file, fromPath: null, placeOnly: held })
  }
  for (const row of paths.values()) {
    if (
      row.archivedAt === null &&
      !present.has(row.path) &&
      !handled.has(row.path) &&
      generatedFolderOf(row.path) === null
    ) {
      archive(row.path)
    }
  }
}

/** The collection a file is placed in; `unplaced` when the layout leaves it out; `refused` (and listed) when it cannot be stored. */
function accept(
  context: RevisionPlanContext,
  file: SourceFile,
  revision: SourceRevisionId,
  layout: SourceLayout,
  ids: ReadonlyMap<LayoutCollection, CollectionId>,
): { readonly collectionId: CollectionId } | 'unplaced' | 'refused' {
  const verdict = acceptSourceDocument(file, context.placer(layout))
  if (verdict.kind === 'left-out') return 'unplaced'
  if (verdict.kind === 'refused') {
    refuse(context, file.path, revision, verdict.reason)
    return 'refused'
  }
  const collectionId = ids.get(verdict.collection)
  /* v8 ignore next -- every collection of a layout is resolved with it. */
  if (collectionId === undefined)
    throw new Error(`No collection resolved for ${verdict.collection.path}.`)
  return { collectionId }
}

function decode(
  context: RevisionPlanContext,
  file: SourceFile,
  contents: ReadonlyMap<string, SourceFileContent>,
  revision: SourceRevisionId,
): string | null {
  const content = contents.get(file.fileId)
  if (content === undefined) {
    throw new ExternalSourceError('file-missing', `The source did not return ${file.path}.`)
  }
  const read = readSourceDocument(content)
  return read.kind === 'text' ? read.text : refuse(context, file.path, revision, read.reason)
}

/** The repository paths a document's relative images point at. */
function imagePaths(path: string, links: readonly ExtractedLink[]): readonly string[] {
  const targets = links
    .filter((link) => link.kind === 'image' && isRelativeDestination(link.url))
    .flatMap((link) => repositoryTarget(path, link.url)?.path ?? [])
  return [...new Set(targets)]
}

function refuse(
  context: RevisionPlanContext,
  path: string,
  revision: SourceRevisionId,
  reason: RefusedSourceFile['reason'],
): null {
  context.refused.set(path, { path, revision, reason })
  return null
}

/** The paths a change names: the old and the new for a rename. */
export function changedPaths(change: SourceChange): readonly string[] {
  if (change.kind === 'removed') return [change.path]
  if (change.kind === 'renamed') return [change.fromPath, change.file.path]
  return [change.file.path]
}

/**
 * The manifest's `redirects` cover what rename detection missed (ADR-061): a
 * file added at a path that a file removed in the same revision redirects to
 * is that file renamed, and keeps its id. Of several removed files
 * redirected to one path, the first the manifest names does.
 */
function withRedirects(
  changes: readonly SourceChange[],
  redirects: ReadonlyMap<string, string>,
  paths: ReadonlyMap<string, SourcePathRow>,
): readonly SourceChange[] {
  if (redirects.size === 0) return changes
  const removed = new Set(
    changes.flatMap((change) =>
      change.kind === 'removed' && paths.get(change.path)?.archivedAt === null ? [change.path] : [],
    ),
  )
  const claimed = new Set<string>()
  const paired = changes.map((change): SourceChange => {
    if (change.kind !== 'added' || paths.get(change.file.path)?.archivedAt === null) return change
    const from = [...redirects].find(
      ([old, target]) => target === change.file.path && removed.has(old) && !claimed.has(old),
    )?.[0]
    if (from === undefined) return change
    claimed.add(from)
    return { kind: 'renamed', fromPath: from, file: change.file }
  })
  return paired.filter((change) => change.kind !== 'removed' || !claimed.has(change.path))
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** What becomes of a repository asset: the upload's own intake takes it in, or it is refused. */
export type SourceAssetIntake =
  | { readonly kind: 'received'; readonly received: Received }
  | { readonly kind: 'refused'; readonly reason: RefusedSourceFile['reason'] }

/** An asset refused before its contents are asked for: a symbolic link is never read. */
export function assetRefusedUnread(
  file: SourceFile,
): Extract<SourceAssetIntake, { kind: 'refused' }> | null {
  return file.kind === 'symbolic-link' ? { kind: 'refused', reason: 'symbolic-link' } : null
}

/**
 * An asset's bytes through the upload's intake (ADR-061, ADR-011): sniffed
 * against the allowlist, held to the upload cap, metadata stripped before
 * the hash, and put in the blob store; or refused, with the reason.
 */
export async function takeInSourceAsset(
  deps: Pick<AttachmentDependencies, 'blobStore' | 'drawingText'> & {
    /** The upload cap (`ATTACHMENT_MAX_BYTES`), which an asset is held to as well. */
    readonly maxAssetBytes: number
  },
  file: SourceFile,
  content: SourceFileContent,
): Promise<SourceAssetIntake> {
  if (content.kind === 'too-large') return { kind: 'refused', reason: 'too-large' }
  const received = await receiveFile(deps, {
    declaredContentType: declaredAssetType(file.path),
    body: once(content.bytes),
    maxBytes: deps.maxAssetBytes,
  })
  return received.kind === 'received'
    ? { kind: 'received', received }
    : { kind: 'refused', reason: received.kind }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes
}

// ---------------------------------------------------------------------------
// Broken links
// ---------------------------------------------------------------------------

/** A relative link of a document, and the repository path it names; null when it leaves the repository. */
export interface RelativeLinkTarget {
  readonly path: string
  readonly url: string
  readonly target: string | null
}

/** Each relative link a document's Markdown holds, and the repository path it names. */
export function relativeLinkTargets(
  format: Pick<DocumentFormat, 'links'>,
  path: string,
  markdown: string,
): readonly RelativeLinkTarget[] {
  return relativeLinkTargetsOf(path, format.links(markdown))
}

/** The same, from links already read. */
export function relativeLinkTargetsOf(
  path: string,
  links: readonly ExtractedLink[],
): readonly RelativeLinkTarget[] {
  const urls = new Set(links.map(({ url }) => url).filter(isRelativeDestination))
  return [...urls].map((url) => ({ path, url, target: repositoryTarget(path, url)?.path ?? null }))
}

/**
 * The relative links that lead nowhere in the repository at a revision
 * (ADR-061, "Broken links are listed per commit"): a path that leaves the
 * repository, or one the repository does not have, inside the source's
 * paths or not. Only names are asked about, never contents.
 */
export async function brokenSourceLinks(
  source: Pick<ExternalSource, 'present'>,
  revision: SourceRevisionId,
  found: readonly RelativeLinkTarget[],
  /** The manifest's redirects: a link to a redirected path is not broken when its redirect leads somewhere. */
  redirects: ReadonlyMap<string, string> = new Map(),
): Promise<readonly BrokenSourceLink[]> {
  const targets = new Set(
    found.flatMap(({ target }) => (target === null ? [] : [target, redirects.get(target) ?? ''])),
  )
  // The repository's root is always there, and is no path to ask about.
  targets.delete('')
  const present =
    targets.size === 0 ? new Set<string>() : await source.present(revision, [...targets])
  const leads = (target: string) => present.has(target) || present.has(redirects.get(target) ?? '')
  return found
    .filter(({ target }) => target === null || (target !== '' && !leads(target)))
    .map(({ path, url }): BrokenSourceLink => ({ path, url, revision }))
}

/** The order the broken links are listed in: by the document's path, then the link. */
export function compareBrokenLinks(left: BrokenSourceLink, right: BrokenSourceLink): number {
  return left.path.localeCompare(right.path) || left.url.localeCompare(right.url)
}

// ---------------------------------------------------------------------------
// Order and nesting
// ---------------------------------------------------------------------------

/** What arranging one document of a collection needs to know about it. */
export interface Arrangeable<I extends string = string> {
  readonly id: I
  readonly path: string
  readonly title: string
  readonly createdAt: Date
}

/**
 * Where each document of one collection goes (ADR-049, ADR-061): the
 * document it nests under, by the folder plan, and its sort key among its
 * siblings, by front matter `order` and then the collection's rule. A
 * collection's own index file goes first unless its front matter says
 * where it goes.
 */
export function arrangeSiblings<I extends string, T extends Arrangeable<I>>(
  documents: readonly T[],
  input: {
    readonly folders: FolderPlan<string>
    /** Each document's front matter `order`, by id. */
    readonly orders: ReadonlyMap<I, number | null>
    readonly rule: SourceCollectionOrder
  },
): readonly { readonly item: T; readonly parentId: I | null; readonly sortKey: number }[] {
  const { folders, orders, rule } = input
  const byPath = new Map(documents.map((document) => [document.path, document.id]))
  const idOf = (path: string | null): I | null => {
    if (path === null) return null
    // A folder's document is live in the same collection; were it not, the
    // document waits at the top rather than stopping the sync.
    /* v8 ignore next */
    return byPath.get(path) ?? null
  }
  const siblings = Map.groupBy(
    documents.map((document) => {
      const parent = folders.parents.get(document.path) ?? null
      return {
        // The last tie-break is the stored path, never the id: an id is
        // minted at random by the sync and from the path by a head plan, and
        // the two must order a collection the same way.
        id: document.path,
        title: document.title,
        createdAt: document.createdAt,
        path: folders.folderOf.get(document.path) ?? document.path,
        // A collection's own README goes first, unless it says where it goes.
        order:
          orders.get(document.id) ?? (folders.leading.has(document.path) ? LEADING_ORDER : null),
        nestUnder: idOf(parent),
        was: document,
      }
    }),
    (document) => document.nestUnder,
  )
  return [...siblings].flatMap(([parentId, group]) =>
    projectSortKeys(group, rule).map(({ item, sortKey }) => ({
      item: item.was,
      parentId,
      sortKey,
    })),
  )
}

export { byCodePoint }
