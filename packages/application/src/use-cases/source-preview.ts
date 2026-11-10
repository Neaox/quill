import type { DocumentId, WorkspaceId } from '@quill/domain'

import type { DocumentFormat } from '../ports/document-format.ts'
import { ExternalSourceError } from '../ports/external-source.ts'
import type { ExternalSource, ExternalSourceFailure, SourceFile } from '../ports/external-source.ts'
import type { CollectionRow, UnitOfWork } from '../ports/persistence.ts'
import type {
  ExternalSourceProvider,
  SourceCollection,
  SourcePathRow,
  WorkspaceSourceCredential,
} from '../ports/source-sync.ts'
import { assetMatcher } from './source-assets.ts'
import { titleFromPath } from './source-files.ts'
import {
  folderTitle,
  generatedFolderOf,
  generatedFolderPath,
  planFolders,
} from './source-folders.ts'
import { layoutPaths, layoutPlacer, readOrder } from './source-layout.ts'
import type { LayoutCollection, SourceLayout, SourcePlacement } from './source-layout.ts'
import type { ManifestNote, ManifestProblem, UnknownManifestKey } from './source-manifest.ts'
import {
  acceptSourceDocument,
  folderRoots,
  isSourceDocument,
  readLayoutAt,
  readSourceDocument,
} from './source-plan.ts'
import type { LayoutReading } from './source-plan.ts'
import { arrangeSiblings } from './source-revision.ts'
import { validateSourceDraft } from './workspace-source.ts'
import type { SourceCollectionInput, WorkspaceSourceField } from './workspace-source.ts'

/**
 * A dry run of a source's settings (ADR-061): what the sync job would make of
 * the branch's head with them, before anything is saved or synced.
 *
 * It opens the source as the sync does — the same outbound policy, the same
 * narrowed partial clone — in a directory of its own that is removed when it
 * ends, reads the head's manifest, narrows to the paths the manifest or the
 * settings name, and places every file there with the sync job's own
 * decisions (`source-plan.ts`, `source-layout.ts`, `source-folders.ts`), so
 * the preview and the sync cannot disagree about where a file goes or why it
 * is left out.
 *
 * **It writes nothing.** No row, no event, no audit entry, nothing in the
 * workspace's store or the source's cache. It only reads the workspace's
 * collections and path map, to say what saving would add, move or archive.
 *
 * **It is bounded.** The provider gives the fetch a shorter deadline than a
 * sync's; at most `MAX_PREVIEW_FILES` files are listed and at most
 * `MAX_PREVIEW_READ_BYTES` of documents are read for their titles, and the
 * preview says when it stopped short. Lists of skipped files are cut at
 * `MAX_PREVIEW_SKIPPED` per reason, with the full count kept.
 */

/** Files listed before the preview stops and says it is partial. */
export const MAX_PREVIEW_FILES = 5000

/** Bytes of documents read for titles and checks; the rest are named by their paths. */
export const MAX_PREVIEW_READ_BYTES = 32 * 1024 * 1024

/** Skipped files listed per reason; the count is always whole. */
export const MAX_PREVIEW_SKIPPED = 200

const PREVIEW_LIMITS = { files: MAX_PREVIEW_FILES, readBytes: MAX_PREVIEW_READ_BYTES }

export interface SourcePreviewDependencies {
  readonly uow: UnitOfWork
  readonly sources: ExternalSourceProvider
  readonly format: DocumentFormat
  /** Accept `file://` remotes. Tests only, as for configuring. */
  readonly allowFileRemotes?: boolean
  /** Lower limits than the defaults, for a test of what happens past them. */
  readonly limits?: Partial<typeof PREVIEW_LIMITS>
}

export interface SourcePreviewCommand {
  readonly workspaceId: WorkspaceId
  readonly remote: string
  readonly branch: string
  readonly credential: WorkspaceSourceCredential | null
  readonly collections: readonly SourceCollectionInput[]
  readonly manifestEntry?: string | null | undefined
  /** Where the manifest is; absent or null for `.quill/workspace.yaml`. */
  readonly manifestPath?: string | null | undefined
}

/** Why the repository could not be read, in the words a form can act on. */
export type SourcePreviewFailure =
  | ExternalSourceFailure
  /** The remote asked for a credential, or refused the one given. */
  | 'credential-refused'
  /** The address leads to no repository, or the host did not answer. */
  | 'unreachable'

/** Why a file the source holds under its paths is not a document of the workspace. */
export type SourcePreviewSkipReason =
  | 'excluded'
  | 'outside'
  | 'too-large'
  | 'not-utf8'
  | 'symbolic-link'
  | 'not-markdown'

export type SourcePreviewChange = 'added' | 'moved' | 'unchanged'

export interface SourcePreviewNode {
  /** The repository path; a generated folder document's is the folder's. */
  readonly path: string
  readonly title: string
  /** A page, a folder whose index file is its page, or a folder whose page Quill writes. */
  readonly kind: 'document' | 'folder' | 'generated-folder'
  /** What saving does to it; null for a workspace not yet read from a repository. */
  readonly change: SourcePreviewChange | null
  readonly children: readonly SourcePreviewNode[]
}

export interface SourcePreviewCollection {
  readonly slug: string
  readonly title: string
  readonly path: string
  readonly order: LayoutCollection['order']
  /** Whether the workspace has it already, under the same name or another. */
  readonly status: 'new' | 'kept' | 'renamed'
  /** Its name now, when saving renames it. */
  readonly previousTitle: string | null
  readonly documents: number
  readonly tree: readonly SourcePreviewNode[]
}

export interface SourcePreviewSkipped {
  readonly reason: SourcePreviewSkipReason
  readonly count: number
  /** The first `MAX_PREVIEW_SKIPPED` of them, by path. */
  readonly paths: readonly string[]
  /** For `excluded`: the pattern that left each listed path out, by path. */
  readonly patterns: Readonly<Record<string, string>>
}

export interface SourcePreviewManifest {
  readonly path: string
  /** `absent`: the head has none, and the settings' collections place the files. */
  readonly state: 'absent' | 'read' | 'problem'
  readonly problem: ManifestProblem | null
  /** The workspaces it describes; a manifest of top-level collections has one with no slug. */
  readonly entries: readonly { readonly slug: string | null; readonly collections: number }[]
  /** The entry the preview read, when it read one. */
  readonly entry: string | null
  readonly unknownKeys: readonly UnknownManifestKey[]
  /** The defaults the entry it read was read with (`ManifestNote`). */
  readonly notes: readonly ManifestNote[]
}

export interface SourcePreviewChanges {
  readonly added: number
  readonly moved: number
  readonly unchanged: number
  /** Documents that leave the workspace, archived as a removed file is. */
  readonly archived: readonly { readonly path: string; readonly title: string }[]
  /** Collections the manifest made that it no longer names, which saving retires. */
  readonly retired: readonly { readonly slug: string; readonly title: string }[]
}

export interface SourcePreview {
  /** The head the preview read. */
  readonly revision: string
  readonly manifest: SourcePreviewManifest
  /** Where the collections come from; null when a manifest problem stops placement. */
  readonly origin: 'manifest' | 'settings' | null
  readonly collections: readonly SourcePreviewCollection[]
  readonly skipped: readonly SourcePreviewSkipped[]
  /** Repository assets the sync would import as attachments. */
  readonly assets: number
  readonly limits: {
    /** Files listed, up to `MAX_PREVIEW_FILES`. */
    readonly files: number
    /** The listing stopped at the limit: there are more files than shown. */
    readonly truncated: boolean
    /** Documents not read for their titles and checks, past the read limit. */
    readonly unread: number
  }
  /** What saving would do to a workspace already read from a repository; null otherwise. */
  readonly changes: SourcePreviewChanges | null
}

export type SourcePreviewResult =
  | { readonly kind: 'preview'; readonly preview: SourcePreview }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-empty' }
  /** Its source was disconnected, and it is never connected again (ADR-061). */
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'invalid'; readonly field: WorkspaceSourceField; readonly message: string }
  | {
      readonly kind: 'unreadable'
      readonly reason: SourcePreviewFailure
      /** What went wrong, with any credential already removed by the adapter. */
      readonly message: string
    }

export async function previewWorkspaceSource(
  deps: SourcePreviewDependencies,
  command: SourcePreviewCommand,
): Promise<SourcePreviewResult> {
  const { repos } = deps.uow
  const workspace = await repos.workspaces.findById(command.workspaceId)
  if (workspace === null) return { kind: 'not-found' }
  const draft = await validateSourceDraft(deps, command)
  if ('kind' in draft) return draft
  if (workspace.origin.kind === 'native' && workspace.origin.disconnected === true) {
    return { kind: 'disconnected' }
  }
  const sourced = workspace.origin.kind === 'sourced'
  if (!sourced && (await repos.documents.listByWorkspace(command.workspaceId)).length > 0) {
    return { kind: 'not-empty' }
  }

  const existing = new Map(
    (await repos.collections.listByWorkspace(command.workspaceId)).map((row) => [row.slug, row]),
  )
  // A settings collection is the workspace's by its slug, as saving makes it;
  // a new one has a key no collection id can be.
  const settings = draft.collections.map((collection) => ({
    ...collection,
    collectionId: existing.get(collection.slug)?.id ?? `new:${collection.slug}`,
  }))
  const drafts = new Map(settings.map((collection) => [collection.collectionId, collection]))

  try {
    const opened = {
      remote: draft.remote,
      branch: draft.branch,
      credential: draft.credential,
      manifestPath: draft.manifestPath,
    }
    return await deps.sources.withDraft(opened, async (source) => {
      const placement = await place(deps, source, {
        settings,
        entry: draft.manifestEntry ?? workspace.slug,
        manifestPath: draft.manifestPath,
      })
      const current = sourced ? await currentState(deps.uow, command.workspaceId) : null
      return {
        kind: 'preview',
        preview: present(placement, { existing, drafts, current }),
      }
    })
  } catch (error) {
    if (!(error instanceof ExternalSourceError)) throw error
    return { kind: 'unreadable', reason: classify(error), message: error.message }
  }
}

// ---------------------------------------------------------------------------
// Placing the head's files, as the sync job would
// ---------------------------------------------------------------------------

interface PlacedDocument {
  readonly path: string
  readonly collection: LayoutCollection
  readonly title: string
  readonly order: number | null
}

interface Placement {
  readonly revision: string
  readonly manifest: SourcePreviewManifest
  readonly layout: SourceLayout | null
  readonly documents: readonly PlacedDocument[]
  readonly skipped: ReadonlyMap<SourcePreviewSkipReason, Map<string, string | null>>
  readonly assets: number
  readonly files: number
  readonly truncated: boolean
  readonly unread: number
}

/** What a document's contents said, by the file's id. */
type ReadDocument =
  | { readonly kind: 'read'; readonly title: string | null; readonly order: number | null }
  | { readonly kind: 'refused'; readonly reason: 'too-large' | 'not-utf8' }

async function place(
  deps: Pick<SourcePreviewDependencies, 'format' | 'limits'>,
  source: ExternalSource,
  options: {
    readonly settings: readonly SourceCollection[]
    readonly entry: string
    readonly manifestPath: string | null
  },
): Promise<Placement> {
  const limits = { ...PREVIEW_LIMITS, ...deps.limits }
  await source.head()
  const revision = await source.fetch()
  const reading = await readLayoutAt(source, revision, {
    collections: options.settings,
    entry: options.entry,
    manifestPath: options.manifestPath,
  })
  const manifest = describeManifest(reading)
  const manifestPath = reading.ok ? reading.layout.manifestPath : reading.manifestPath
  const skipped = new Map<SourcePreviewSkipReason, Map<string, string | null>>()
  const skip = (reason: SourcePreviewSkipReason, path: string, pattern: string | null = null) => {
    const list = skipped.get(reason) ?? new Map<string, string | null>()
    list.set(path, pattern)
    skipped.set(reason, list)
  }
  const empty = { revision, manifest, skipped, assets: 0, files: 0, truncated: false, unread: 0 }
  if (!reading.ok) return { ...empty, layout: null, documents: [] }
  const { layout } = reading
  await source.narrow(layoutPaths(layout))

  const placer = layoutPlacer(layout)
  const isAsset = assetMatcher(layout, placer)
  const wanted: { readonly file: SourceFile; readonly collection: LayoutCollection }[] = []
  let files = 0
  let assets = 0
  let truncated = false
  for await (const file of source.files(revision)) {
    if (files >= limits.files) {
      truncated = true
      break
    }
    files += 1
    // The manifest, and a file at a path only Quill's folder pages take, are no one's page.
    if (file.path === manifestPath || generatedFolderOf(file.path) !== null) continue
    if (isSourceDocument(file.path)) {
      const verdict = acceptSourceDocument(file, placer)
      if (verdict.kind === 'placed') wanted.push({ file, collection: verdict.collection })
      else if (verdict.kind === 'refused') skip(verdict.reason, file.path)
      else skipLeftOut(skip, placer.placement(file.path), file.path)
    } else if (isAsset(file.path)) {
      assets += 1
    } else {
      const where = placer.placement(file.path)
      if (where.kind === 'placed') skip('not-markdown', file.path)
      else skipLeftOut(skip, where, file.path)
    }
  }

  const read = await readDocuments(deps.format, source, wanted, limits.readBytes)
  const documents: PlacedDocument[] = []
  let unread = 0
  for (const { file, collection } of wanted) {
    const found = read.get(file.fileId)
    if (found?.kind === 'refused') {
      skip(found.reason, file.path)
      continue
    }
    if (found === undefined) unread += 1
    documents.push({
      path: file.path,
      collection,
      title: found?.title ?? titleFromPath(file.path),
      order: found?.order ?? null,
    })
  }
  return { ...empty, layout, documents, assets, files, truncated, unread }
}

/** Lists a file the layout leaves out, under why. */
function skipLeftOut(
  skip: (reason: SourcePreviewSkipReason, path: string, pattern?: string | null) => void,
  where: SourcePlacement,
  path: string,
): void {
  if (where.kind === 'excluded') skip('excluded', path, where.pattern)
  else skip('outside', path)
}

/**
 * Each document's title, `order` and checks, from its contents, until the
 * byte budget is spent; what is not read by then is left out of the answer.
 */
async function readDocuments(
  format: DocumentFormat,
  source: ExternalSource,
  wanted: readonly { readonly file: SourceFile }[],
  budget: number,
): Promise<ReadonlyMap<string, ReadDocument>> {
  const read = new Map<string, ReadDocument>()
  if (wanted.length === 0) return read
  let left = budget
  const ids = new Set(wanted.map(({ file }) => file.fileId))
  for await (const content of source.readFiles(ids)) {
    const contents = readSourceDocument(content)
    if (contents.kind === 'refused') {
      read.set(content.fileId, contents)
      continue
    }
    const view = format.read(contents.text)
    read.set(content.fileId, {
      kind: 'read',
      title: view.title ?? null,
      order: readOrder(view.frontMatter['order']),
    })
    left -= contents.text.length
    if (left <= 0) break
  }
  return read
}

function describeManifest(reading: LayoutReading): SourcePreviewManifest {
  const { manifest } = reading
  const common = {
    path: reading.ok ? reading.layout.manifestPath : reading.manifestPath,
    entries: (manifest?.entries ?? []).map(({ slug, collections }) => ({
      slug,
      collections: collections.length,
    })),
    unknownKeys: manifest?.unknownKeys ?? [],
    notes: reading.ok ? reading.layout.notes : [],
  }
  if (!reading.ok) return { ...common, state: 'problem', problem: reading.problem, entry: null }
  return {
    ...common,
    state: manifest === null ? 'absent' : 'read',
    problem: null,
    entry: reading.entry?.slug ?? null,
  }
}

// ---------------------------------------------------------------------------
// What the workspace holds now, and what saving does to it
// ---------------------------------------------------------------------------

interface CurrentState {
  /** The live entries of the path map, by path. */
  readonly live: ReadonlyMap<string, SourcePathRow>
  /** Each document's collection and title. */
  readonly documents: ReadonlyMap<
    DocumentId,
    { readonly collectionId: string | null; readonly title: string }
  >
  /** The collections the manifest made at the last sync, which it may retire. */
  readonly manifestCollections: readonly string[]
  /** Each folder's live index file, by the folder, as the path map holds them. */
  readonly indexes: ReadonlyMap<string, string>
}

async function currentState(uow: UnitOfWork, workspaceId: WorkspaceId): Promise<CurrentState> {
  const { repos } = uow
  const [paths, documents, state] = await Promise.all([
    repos.sourcePaths.listByWorkspace(workspaceId),
    repos.documents.listByWorkspace(workspaceId),
    repos.sourceSyncState.find(workspaceId),
  ])
  const live = new Map(paths.flatMap((row) => (row.archivedAt === null ? [[row.path, row]] : [])))
  const indexes = new Map<string, string>()
  for (const path of live.keys()) {
    const folder = folderOfIndex(path)
    if (folder !== null) indexes.set(folder, path)
  }
  return {
    live,
    indexes,
    documents: new Map(
      documents.map((row) => [row.id, { collectionId: row.collectionId, title: row.title }]),
    ),
    manifestCollections: state?.layout?.collectionIds ?? [],
  }
}

/** One page of the tree as the preview shows it, before it is nested. */
interface Entry {
  /** The path the plan knows it by: a generated folder page's stored path. */
  readonly key: string
  /** The path a person knows it by: a generated folder page's is the folder's. */
  readonly path: string
  readonly title: string
  readonly kind: SourcePreviewNode['kind']
  readonly collection: string
  /** What it is ordered by among its siblings: a folder page by its folder's name. */
  readonly sortPath: string
  readonly order: number | null
}

/** A collection of the layout as the workspace will have it. */
interface Described {
  /** The collection's row id, or `new:<slug>` for one saving creates. */
  readonly key: string
  readonly slug: string
  readonly title: string
  readonly row: CollectionRow | undefined
}

function present(
  placement: Placement,
  context: {
    readonly existing: ReadonlyMap<string, CollectionRow>
    readonly drafts: ReadonlyMap<string, { readonly slug: string; readonly name: string }>
    readonly current: CurrentState | null
  },
): SourcePreview {
  const { layout, documents } = placement
  const { existing, drafts, current } = context
  const described = new Map<LayoutCollection, Described>()
  for (const collection of layout?.collections ?? []) {
    const { slug, title } =
      collection.from === 'manifest' ? collection : describeDraft(drafts, collection.collectionId)
    const row = existing.get(slug)
    described.set(collection, { key: row?.id ?? `new:${slug}`, slug, title, row })
  }
  const keyOf = (collection: LayoutCollection): string => describedOf(described, collection).key

  const plan = planFolders(
    documents.map(({ path, collection }) => ({ path, collection: keyOf(collection) })),
    layout === null ? [] : folderRoots(layout, keyOf),
  )
  const entries: Entry[] = [
    ...documents.map(({ path, title, order, collection }): Entry => {
      const folder = plan.folderOf.get(path)
      return {
        key: path,
        path,
        title,
        kind: folder === undefined ? 'document' : 'folder',
        collection: keyOf(collection),
        sortPath: folder ?? path,
        order,
      }
    }),
    ...[...plan.generated].map(([folder, collection]): Entry => ({
      key: generatedFolderPath(folder),
      path: folder,
      title: folderTitle(folder),
      kind: 'generated-folder',
      collection,
      sortPath: folder,
      order: null,
    })),
  ]
  const changeOf = changes(entries, current)

  const trees = [...described].map(([collection, { key, slug, title, row }]) => {
    const own = entries.filter((entry) => entry.collection === key)
    // Placed as the sync places them (`arrangeSiblings`): nested by the
    // folder plan, ordered by front matter and then the collection's rule.
    const arranged = arrangeSiblings(
      own.map((entry) => ({
        id: entry.key,
        path: entry.key,
        title: entry.title,
        entry,
        // A preview knows no first appearance; `newest` and `oldest` fall back to the path.
        createdAt: new Date(0),
      })),
      {
        folders: plan,
        orders: new Map(own.map((entry) => [entry.key, entry.order])),
        rule: collection.order,
      },
    )
    const children = Map.groupBy(arranged, ({ parentId }) => parentId)
    const build = (parent: string | null): SourcePreviewNode[] =>
      (children.get(parent) ?? [])
        .toSorted((left, right) => left.sortKey - right.sortKey)
        .map(({ item: { entry } }) => ({
          path: entry.path,
          title: entry.title,
          kind: entry.kind,
          change: changeOf.get(entry.key) ?? null,
          children: build(entry.key),
        }))
    const renamed = row !== undefined && row.name !== title
    return {
      slug,
      title,
      path: collection.path,
      order: collection.order,
      status: row === undefined ? 'new' : renamed ? 'renamed' : 'kept',
      previousTitle: renamed ? row.name : null,
      documents: own.length,
      tree: build(null),
    } satisfies SourcePreviewCollection
  })

  const skipped = [...placement.skipped].map(([reason, paths]): SourcePreviewSkipped => {
    const listed = [...paths].toSorted(([left], [right]) => left.localeCompare(right))
    const shown = listed.slice(0, MAX_PREVIEW_SKIPPED)
    const patterns = Object.fromEntries(
      shown.flatMap(([path, pattern]) => (pattern === null ? [] : [[path, pattern]])),
    )
    return { reason, count: paths.size, paths: shown.map(([path]) => path), patterns }
  })

  return {
    revision: placement.revision,
    manifest: placement.manifest,
    origin: layout?.origin ?? null,
    collections: trees,
    skipped,
    assets: placement.assets,
    limits: {
      files: placement.files,
      truncated: placement.truncated,
      unread: placement.unread,
    },
    changes:
      current === null || layout === null
        ? null
        : summarise(changeOf, entries, current, [...described.values()], existing),
  }
}

function describeDraft(
  drafts: ReadonlyMap<string, { readonly slug: string; readonly name: string }>,
  key: string,
): { readonly slug: string; readonly title: string } {
  const draft = drafts.get(key)
  /* v8 ignore next -- a settings collection of the layout is one of the draft's. */
  if (draft === undefined) throw new Error(`No collection drafted as ${key}.`)
  return { slug: draft.slug, title: draft.name }
}

function describedOf(
  described: ReadonlyMap<LayoutCollection, Described>,
  collection: LayoutCollection,
): Described {
  const found = described.get(collection)
  /* v8 ignore next -- every collection of the layout is described with it. */
  if (found === undefined) throw new Error(`No collection described for ${collection.path}.`)
  return found
}

/**
 * What saving does to each planned page: added when the workspace does not
 * hold its path, moved when it does in another collection, unchanged
 * otherwise. A folder whose page moves between its index file and a page
 * Quill writes keeps its document (ADR-061), so it counts as the page it was.
 */
function changes(
  entries: readonly Entry[],
  current: CurrentState | null,
): ReadonlyMap<string, SourcePreviewChange> {
  const result = new Map<string, SourcePreviewChange>()
  if (current === null) return result
  for (const entry of entries) {
    const row = current.live.get(entry.key) ?? standIn(entry, current)
    if (row === undefined) {
      result.set(entry.key, 'added')
      continue
    }
    const now = documentOf(current, row).collectionId
    result.set(entry.key, now === entry.collection ? 'unchanged' : 'moved')
  }
  return result
}

/** The document a live path map entry names. */
function documentOf(
  current: CurrentState,
  row: SourcePathRow,
): { readonly collectionId: string | null; readonly title: string } {
  const document = current.documents.get(row.documentId)
  /* v8 ignore next -- a path map entry names a document of the workspace. */
  if (document === undefined) throw new Error(`No document ${row.documentId} for ${row.path}.`)
  return document
}

/** The path map entry that stands for the same folder under its other kind of page. */
function standIn(entry: Entry, current: CurrentState): SourcePathRow | undefined {
  const path =
    entry.kind === 'generated-folder'
      ? current.indexes.get(entry.path)
      : entry.kind === 'folder'
        ? generatedFolderPath(entry.sortPath)
        : undefined
  return path === undefined ? undefined : current.live.get(path)
}

/** The folder an index file would stand for, by its name alone. */
function folderOfIndex(path: string): string | null {
  const slash = path.lastIndexOf('/')
  return INDEX_FILE.test(path.slice(slash + 1)) ? path.slice(0, Math.max(slash, 0)) : null
}

const INDEX_FILE = /^(?:index|readme)\.(?:md|markdown)$/iu

function summarise(
  changeOf: ReadonlyMap<string, SourcePreviewChange>,
  entries: readonly Entry[],
  current: CurrentState,
  kept: readonly Described[],
  existing: ReadonlyMap<string, CollectionRow>,
): SourcePreviewChanges {
  const count = (change: SourcePreviewChange) =>
    [...changeOf.values()].filter((value) => value === change).length
  // A page that stays, and the page a folder had under its other kind, are not archived.
  const taken = new Set<string>()
  for (const entry of entries) {
    taken.add(entry.key)
    const row = standIn(entry, current)
    if (row !== undefined) taken.add(row.path)
  }
  const archived = [...current.live.values()]
    .filter((row) => !taken.has(row.path))
    .map((row) => ({
      path: generatedFolderOf(row.path) ?? row.path,
      title: documentOf(current, row).title,
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path))
  const keep = new Set(kept.map(({ key }) => key))
  const byId = new Map([...existing.values()].map((row) => [row.id, row]))
  const retired = current.manifestCollections.flatMap((id) => {
    const row = keep.has(id) ? undefined : byId.get(id)
    return row === undefined ? [] : [{ slug: row.slug, title: row.name }]
  })
  return {
    added: count('added'),
    moved: count('moved'),
    unchanged: count('unchanged'),
    archived,
    retired,
  }
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

const CREDENTIAL_REFUSED =
  /authentication failed|could not read (?:username|password)|terminal prompts disabled|invalid username or password|http (?:401|403)|returned error: 40[13]/iu
const UNREACHABLE =
  /could not resolve host|failed to connect|connection (?:refused|timed out|reset)|repository not found|not found|does not appear to be a git repository|unable to access|ssl|tls|returned error: 404/iu

/** A host name that does not resolve, as the outbound policy reports it. */
const UNRESOLVED = /enotfound|eai_again|eai_noname|getaddrinfo|could not resolve|no addresses/iu

/** A git failure in the words a form acts on: a credential, an address, or something else. */
function classify(error: ExternalSourceError): SourcePreviewFailure {
  // The policy refuses a name it cannot resolve, which is no host at all, not a forbidden one.
  if (error.reason === 'blocked-by-outbound-policy' && UNRESOLVED.test(error.message)) {
    return 'unreachable'
  }
  if (error.reason !== 'command-failed') return error.reason
  if (CREDENTIAL_REFUSED.test(error.message)) return 'credential-refused'
  if (UNREACHABLE.test(error.message)) return 'unreachable'
  return 'command-failed'
}
