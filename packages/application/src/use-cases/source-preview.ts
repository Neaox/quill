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
import type { FolderPlan } from './source-folders.ts'
import {
  LEADING_ORDER,
  layoutPaths,
  layoutPlacer,
  projectSortKeys,
  readOrder,
} from './source-layout.ts'
import type { LayoutCollection, SourceLayout } from './source-layout.ts'
import { SOURCE_MANIFEST_PATH } from './source-manifest.ts'
import type { ManifestProblem, SourceManifest, UnknownManifestKey } from './source-manifest.ts'
import {
  acceptSourceDocument,
  folderRoots,
  isSourceDocument,
  readLayoutAt,
  readSourceDocument,
} from './source-plan.ts'
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

export interface SourcePreviewDependencies {
  readonly uow: UnitOfWork
  readonly sources: ExternalSourceProvider
  readonly format: DocumentFormat
  /** Accept `file://` remotes. Tests only, as for configuring. */
  readonly allowFileRemotes?: boolean
}

export interface SourcePreviewCommand {
  readonly workspaceId: WorkspaceId
  readonly remote: string
  readonly branch: string
  readonly credential: WorkspaceSourceCredential | null
  readonly collections: readonly SourceCollectionInput[]
  readonly manifestEntry?: string | null | undefined
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
  const sourced = workspace.origin.kind === 'sourced'
  if (!sourced && (await repos.documents.listByWorkspace(command.workspaceId)).length > 0) {
    return { kind: 'not-empty' }
  }

  const existing = new Map(
    (await repos.collections.listByWorkspace(command.workspaceId)).map((row) => [row.slug, row]),
  )
  // A settings collection is the workspace's by its slug, as saving makes it;
  // a new one has a key no collection id can be.
  const settings: SourceCollection[] = draft.collections.map(({ slug, path }) => ({
    collectionId: existing.get(slug)?.id ?? `new:${slug}`,
    path,
  }))
  const names = new Map(draft.collections.map(({ slug, name }) => [slug, name]))

  try {
    const opened = { remote: draft.remote, branch: draft.branch, credential: draft.credential }
    return await deps.sources.withDraft(opened, async (source) => {
      const placement = await place(deps.format, source, {
        settings,
        entry: draft.manifestEntry ?? workspace.slug,
      })
      const current = sourced ? await currentState(deps.uow, command.workspaceId) : null
      return {
        kind: 'preview',
        preview: present(placement, { existing, names, current }),
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

async function place(
  format: DocumentFormat,
  source: ExternalSource,
  options: { readonly settings: readonly SourceCollection[]; readonly entry: string },
): Promise<Placement> {
  await source.head()
  const revision = await source.fetch()
  const reading = await readLayoutAt(source, revision, {
    collections: options.settings,
    entry: options.entry,
  })
  const manifest = describeManifest(reading.manifest, reading)
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
    if (files >= MAX_PREVIEW_FILES) {
      truncated = true
      break
    }
    files += 1
    if (file.path === SOURCE_MANIFEST_PATH) continue
    if (!isSourceDocument(file.path)) {
      if (isAsset(file.path)) assets += 1
      else if (generatedFolderOf(file.path) === null) {
        const where = placer.placement(file.path)
        if (where.kind === 'excluded') skip('excluded', file.path, where.pattern)
        else skip(where.kind === 'outside' ? 'outside' : 'not-markdown', file.path)
      }
      continue
    }
    const verdict = acceptSourceDocument(file, placer)
    if (verdict.kind === 'placed') wanted.push({ file, collection: verdict.collection })
    else if (verdict.kind === 'refused') skip(verdict.reason, file.path)
    else {
      const where = placer.placement(file.path)
      skip(verdict.reason, file.path, where.kind === 'excluded' ? where.pattern : null)
    }
  }

  // Each document's title and checks, from its contents, until the budget is spent.
  const read = new Map<string, { readonly title: string; readonly order: number | null }>()
  const refused = new Map<string, 'too-large' | 'not-utf8'>()
  const byId = Map.groupBy(wanted, ({ file }) => file.fileId)
  let budget = MAX_PREVIEW_READ_BYTES
  if (wanted.length > 0) {
    for await (const content of source.readFiles(byId.keys())) {
      const contents = readSourceDocument(content)
      for (const { file } of byId.get(content.fileId) ?? []) {
        if (contents.kind === 'refused') refused.set(file.path, contents.reason)
        else {
          const view = format.read(contents.text)
          read.set(file.path, {
            title: view.title ?? titleFromPath(file.path),
            order: readOrder(view.frontMatter['order']),
          })
        }
      }
      budget -= content.kind === 'content' ? content.bytes.byteLength : 0
      if (budget <= 0) break
    }
  }
  const documents: PlacedDocument[] = []
  let unread = 0
  for (const { file, collection } of wanted) {
    const reason = refused.get(file.path)
    if (reason !== undefined) {
      skip(reason, file.path)
      continue
    }
    const found = read.get(file.path)
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

function describeManifest(
  manifest: SourceManifest | null,
  reading: Awaited<ReturnType<typeof readLayoutAt>>,
): SourcePreviewManifest {
  const entries = (manifest?.entries ?? []).map(({ slug, collections }) => ({
    slug,
    collections: collections.length,
  }))
  if (!reading.ok) {
    return {
      path: SOURCE_MANIFEST_PATH,
      state: 'problem',
      problem: reading.problem,
      entries,
      entry: null,
      unknownKeys: manifest?.unknownKeys ?? [],
    }
  }
  if (manifest === null) {
    return {
      path: SOURCE_MANIFEST_PATH,
      state: 'absent',
      problem: null,
      entries: [],
      entry: null,
      unknownKeys: [],
    }
  }
  return {
    path: SOURCE_MANIFEST_PATH,
    state: 'read',
    problem: null,
    entries,
    entry: reading.entry?.slug ?? null,
    unknownKeys: manifest.unknownKeys,
  }
}

// ---------------------------------------------------------------------------
// What the workspace holds now, and what saving does to it
// ---------------------------------------------------------------------------

interface CurrentState {
  /** The live entries of the path map, by path. */
  readonly live: ReadonlyMap<string, SourcePathRow>
  /** Each live document's collection and title. */
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
    if (folder !== null && !indexes.has(folder)) indexes.set(folder, path)
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

function present(
  placement: Placement,
  context: {
    readonly existing: ReadonlyMap<string, CollectionRow>
    readonly names: ReadonlyMap<string, string>
    readonly current: CurrentState | null
  },
): SourcePreview {
  const { layout, documents } = placement
  const { existing, names, current } = context
  const byId = new Map([...existing.values()].map((row) => [row.id, row]))
  const describe = (collection: LayoutCollection) => {
    if (collection.from === 'manifest') {
      return { slug: collection.slug, title: collection.title, row: existing.get(collection.slug) }
    }
    const row = byId.get(collection.collectionId)
    const slug = row?.slug ?? collection.collectionId.replace(/^new:/u, '')
    return { slug, title: names.get(slug) ?? row?.name ?? slug, row }
  }
  // Each layout collection by a key that is its row's id when it has one.
  const keyOf = (collection: LayoutCollection): string => {
    const { slug, row } = describe(collection)
    return row?.id ?? `new:${slug}`
  }

  const collections = layout?.collections ?? []
  const plan = planFolders(
    documents.map(({ path, collection }) => ({ path, collection: keyOf(collection) })),
    layout === null ? [] : folderRoots(layout, keyOf),
  )
  const titles = new Map(documents.map(({ path, title }) => [path, title]))
  const orders = new Map(documents.map(({ path, order }) => [path, order]))
  const changeOf = changes(plan, documents, keyOf, current)

  const trees = collections.map((collection): SourcePreviewCollection => {
    const key = keyOf(collection)
    const { slug, title, row } = describe(collection)
    const inCollection = [
      ...documents.filter((document) => keyOf(document.collection) === key).map(({ path }) => path),
      ...[...plan.generated].flatMap(([folder, owner]) =>
        owner === key ? [generatedFolderPath(folder)] : [],
      ),
    ]
    const node = (path: string): Omit<SourcePreviewNode, 'children'> => {
      const folder = plan.folderOf.get(path)
      const generated = generatedFolderOf(path)
      return {
        path: generated ?? path,
        title:
          generated === null
            ? (titles.get(path) ?? titleFromPath(path))
            : folderTitle(folder ?? generated),
        kind:
          generated !== null ? 'generated-folder' : folder === undefined ? 'document' : 'folder',
        change: changeOf.get(path) ?? null,
      }
    }
    const children = Map.groupBy(inCollection, (path) => plan.parents.get(path) ?? null)
    const build = (parent: string | null): SourcePreviewNode[] => {
      const siblings = (children.get(parent) ?? []).map((path, index) => ({
        id: String(index),
        path: plan.folderOf.get(path) ?? path,
        own: path,
        title: titles.get(path) ?? folderTitle(plan.folderOf.get(path) ?? path),
        order: orders.get(path) ?? (plan.leading.has(path) ? LEADING_ORDER : null),
        // A preview knows no first appearance; `newest` and `oldest` fall back to the path.
        createdAt: new Date(0),
      }))
      return projectSortKeys(siblings, collection.order)
        .toSorted((left, right) => left.sortKey - right.sortKey)
        .map(({ item }) => ({ ...node(item.own), children: build(item.own) }))
    }
    return {
      slug,
      title,
      path: collection.path,
      order: collection.order,
      status: row === undefined ? 'new' : row.name === title ? 'kept' : 'renamed',
      previousTitle: row !== undefined && row.name !== title ? row.name : null,
      documents: inCollection.length,
      tree: build(null),
    }
  })

  const skipped = [...placement.skipped].map(([reason, paths]): SourcePreviewSkipped => {
    const listed = [...paths.keys()].toSorted().slice(0, MAX_PREVIEW_SKIPPED)
    const patterns: Record<string, string> = {}
    for (const path of listed) {
      const pattern = paths.get(path)
      if (pattern !== undefined && pattern !== null) patterns[path] = pattern
    }
    return { reason, count: paths.size, paths: listed, patterns }
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
        : summarise(changeOf, plan, current, collections.map(keyOf), byId),
  }
}

/**
 * What saving does to each planned document: added when the workspace does
 * not hold its path, moved when it does in another collection, unchanged
 * otherwise. A folder whose page moves between its index file and a page
 * Quill writes keeps its document (ADR-061), so neither side counts.
 */
function changes(
  plan: FolderPlan<string>,
  documents: readonly PlacedDocument[],
  keyOf: (collection: LayoutCollection) => string,
  current: CurrentState | null,
): ReadonlyMap<string, SourcePreviewChange> {
  const result = new Map<string, SourcePreviewChange>()
  if (current === null) return result
  const planned = new Map<string, string>([
    ...documents.map(({ path, collection }) => [path, keyOf(collection)] as const),
    ...[...plan.generated].map(([folder, key]) => [generatedFolderPath(folder), key] as const),
  ])
  for (const [path, key] of planned) {
    const row = current.live.get(path) ?? standIn(path, plan, current)
    if (row === undefined) {
      result.set(path, 'added')
      continue
    }
    const now = current.documents.get(row.documentId)?.collectionId ?? null
    result.set(path, now === key ? 'unchanged' : 'moved')
  }
  return result
}

/** The path map entry that stands for the same folder under its other kind of page. */
function standIn(
  path: string,
  plan: FolderPlan<string>,
  current: CurrentState,
): SourcePathRow | undefined {
  const generated = generatedFolderOf(path)
  if (generated !== null) {
    const index = current.indexes.get(generated)
    return index === undefined ? undefined : current.live.get(index)
  }
  const folder = plan.folderOf.get(path)
  return folder === undefined ? undefined : current.live.get(generatedFolderPath(folder))
}

/** The folder an index file would stand for, by its name alone. */
function folderOfIndex(path: string): string | null {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  return /^(?:index|readme)\.(?:md|markdown)$/iu.test(name) && slash > 0
    ? path.slice(0, slash)
    : null
}

function summarise(
  changeOf: ReadonlyMap<string, SourcePreviewChange>,
  plan: FolderPlan<string>,
  current: CurrentState,
  kept: readonly string[],
  byId: ReadonlyMap<string, CollectionRow>,
): SourcePreviewChanges {
  const count = (change: SourcePreviewChange) =>
    [...changeOf.values()].filter((value) => value === change).length
  const taken = new Set<string>(changeOf.keys())
  // A folder's page that changes kind keeps its document: the old path is not archived.
  for (const path of changeOf.keys()) {
    const generated = generatedFolderOf(path)
    if (generated !== null) {
      const index = current.indexes.get(generated)
      if (index !== undefined) taken.add(index)
    } else {
      const folder = plan.folderOf.get(path)
      if (folder !== undefined) taken.add(generatedFolderPath(folder))
    }
  }
  const archived = [...current.live.values()]
    .filter((row) => !taken.has(row.path))
    .map((row) => ({
      path: generatedFolderOf(row.path) ?? row.path,
      title: current.documents.get(row.documentId)?.title ?? titleFromPath(row.path),
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path))
  const keep = new Set(kept)
  const retired = current.manifestCollections
    .filter((id) => !keep.has(id))
    .flatMap((id) => {
      const row = byId.get(id)
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

/** A git failure in the words a form acts on: a credential, an address, or something else. */
function classify(error: ExternalSourceError): SourcePreviewFailure {
  if (error.reason !== 'command-failed') return error.reason
  if (CREDENTIAL_REFUSED.test(error.message)) return 'credential-refused'
  if (UNREACHABLE.test(error.message)) return 'unreachable'
  return 'command-failed'
}
