import { BRAND } from '@quill/brand'
import { collectionId as toCollectionId } from '@quill/domain'
import type { DocumentId, RevisionId, ShortId, WorkspaceId } from '@quill/domain'

import { AUTHORED_AT_MAX_SKEW_MS, checkSourceStamp } from '../ports/content-store.ts'
import type { ContentChange } from '../ports/content-store.ts'
import type { ContentStore } from '../ports/content-store.ts'
import type { BlobStore } from '../ports/blob-store.ts'
import type { DrawingText } from '../ports/drawing-text.ts'
import type { DocumentFormat } from '../ports/document-format.ts'
import { ExternalSourceError } from '../ports/external-source.ts'
import type {
  SourceChange,
  SourceFile,
  SourceFileContent,
  SourceRevision,
  SourceRevisionId,
} from '../ports/external-source.ts'
import type {
  CollectionId,
  DocumentRow,
  RepositoryBundle,
  UnitOfWork,
} from '../ports/persistence.ts'
import type {
  BrokenSourceLink,
  ConnectedSource,
  ExternalSourceProvider,
  RefusedSourceFile,
  SourceLayoutRecord,
  SourcePathRow,
  SourceSyncFailure,
  SourceSyncFailureReason,
  SourceSyncLock,
} from '../ports/source-sync.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { MAX_SHORT_ID_ATTEMPTS } from './create-document.ts'
import { namedSlug } from './document-path.ts'
import {
  collectionDeleted,
  documentMoved,
  documentPublished,
  documentRenamed,
  parseSourceSyncRequested,
  sourceSyncRequested,
} from './events.ts'
import type { SourceSyncTrigger } from './events.ts'
import { receiveFile, safeFilename } from './attachments.ts'
import type { Received } from './attachments.ts'
import {
  assetFilename,
  assetMatcher,
  declaredAssetType,
  SOURCE_ASSET_MAP_PATH,
  writeAssetMap,
} from './source-assets.ts'
import { decodeUtf8, isDocumentPath, titleFromPath } from './source-files.ts'
import { isRelativeDestination, repositoryTarget } from './source-links.ts'
import {
  layoutFromManifest,
  layoutFromSettings,
  layoutPaths,
  layoutPlacer,
  projectSortKeys,
  readOrder,
} from './source-layout.ts'
import type { LayoutCollection, LayoutPlacer, SourceLayout } from './source-layout.ts'
import {
  describeManifestProblem,
  parseSourceManifest,
  selectManifestEntry,
  SOURCE_MANIFEST_PATH,
} from './source-manifest.ts'
import type { ManifestProblem } from './source-manifest.ts'

/**
 * The sync job of a sourced workspace (ADR-061): the one writer of its
 * content, and the one consumer of `SourceSyncRequested`.
 *
 * It is idempotent and single-flight. Holding the source's lock, it reads the
 * remote head and stops when that is the revision it last synced and the
 * layout it placed the tree by still holds. Otherwise it fetches, reads the
 * head's manifest, narrows the source to what that manifest names, and
 * replays the source's main-line revisions, oldest first, each as one publish
 * of everything it changed, authored by the revision's author at the time it
 * reached the branch, with a compare-and-swap on the store's head. Each
 * revision's publish is recorded — documents, collections, path map,
 * revisions index, events and how far the sync got — in one transaction, so
 * a failure part-way leaves the workspace at the last revision that synced
 * and never empties it.
 *
 * **The layout.** Where each file goes comes from the source's manifest
 * (`.quill/workspace.yaml`) at the revision being replayed, or, at a revision
 * with none, from the collections in the source's stored settings. A
 * revision whose layout differs from the one the tree was last placed by
 * re-plans the whole tree: collections are created, retitled or retired by
 * slug, and every file is placed again from the revision's own tree, not
 * only the files it changed. A layout that changed with no new revision
 * (the stored settings changed) re-plans at the newest revision.
 *
 * **What it reads.** The source is narrowed to the head manifest's paths
 * before the history is read, so the instance never fetches what the
 * current manifest does not name; earlier revisions are replayed through
 * those paths. Only the head's manifest can stop a sync: a revision in
 * between whose manifest does not read keeps the layout before it.
 *
 * A revision already in the revisions index is skipped, so an interrupted
 * replay resumes where it stopped. A rewritten branch is not replayed: the
 * difference between what is stored and the new head is published as one
 * revision, and Quill's own history is never rewritten.
 */

export interface SyncSourceDependencies {
  readonly uow: UnitOfWork
  /** The store that writes. People's requests are composed with one that refuses (ADR-061). */
  readonly contentStore: ContentStore
  readonly format: DocumentFormat
  readonly sources: ExternalSourceProvider
  readonly lock: SourceSyncLock
  readonly clock: Clock
  readonly ids: IdGenerator
  /** Where an imported asset's bytes go, as an upload's do (ADR-061, ADR-011). */
  readonly blobStore: BlobStore
  /** Reads a drawing's words for search, as an upload's are. */
  readonly drawingText: DrawingText
  /** The upload cap (`ATTACHMENT_MAX_BYTES`), which an asset is held to as well. */
  readonly maxAssetBytes: number
}

export interface SyncSourceCommand {
  readonly workspaceId: WorkspaceId
}

export type SyncSourceResult =
  | { readonly kind: 'not-sourced' }
  /** Another sync of this source is running; it will reach the same head. */
  | { readonly kind: 'busy' }
  | { readonly kind: 'up-to-date'; readonly revision: SourceRevisionId }
  | {
      readonly kind: 'synced'
      readonly revision: SourceRevisionId
      /** How many revisions were published; revisions already recorded are not counted. */
      readonly published: number
    }
  | { readonly kind: 'failed'; readonly failure: SourceSyncFailure }

/** The change note of the one revision a rewritten branch gets. */
export const HISTORY_REWRITTEN_SUMMARY = "The source's history was rewritten"

/** The change note of a re-plan that no new revision brought: the stored settings changed. */
export const LAYOUT_CHANGED_SUMMARY = "The source's layout changed"

/** The change note of a first sync that imports only the head. */
export function importedAtSummary(revision: SourceRevisionId): string {
  return `Imported at ${revision}`
}

export async function syncSource(
  deps: SyncSourceDependencies,
  command: SyncSourceCommand,
): Promise<SyncSourceResult> {
  const connected = await deps.sources.forWorkspace(command.workspaceId)
  if (connected === null) return { kind: 'not-sourced' }
  const outcome = await deps.lock.withLock(command.workspaceId, () =>
    new SourceReplay(deps, command.workspaceId, connected).run(),
  )
  return outcome.kind === 'busy' ? { kind: 'busy' } : outcome.value
}

/**
 * Asks for a sync (ADR-061, "Freshness"): what every trigger does. The request
 * is an outbox event, so it is durable, retried, and handled off the request
 * path by the one sync job.
 */
export async function requestSourceSync(
  deps: Pick<SyncSourceDependencies, 'uow' | 'clock'>,
  command: { readonly workspaceId: WorkspaceId; readonly trigger: SourceSyncTrigger },
): Promise<void> {
  await deps.uow.run((tx) =>
    tx.events.record(
      sourceSyncRequested,
      { workspaceId: command.workspaceId, trigger: command.trigger },
      deps.clock.now(),
    ),
  )
}

/**
 * The `SourceSyncRequested` consumer: a sync of the workspace the event names.
 * A payload this release cannot read is left alone (null), as every consumer
 * leaves one (ADR-033).
 */
export async function handleSourceSyncRequested(
  deps: SyncSourceDependencies,
  payload: unknown,
): Promise<SyncSourceResult | null> {
  const event = parseSourceSyncRequested(payload)
  if (event === null) return null
  return await syncSource(deps, { workspaceId: event.workspaceId })
}

/** A sync stopped for a reason the job names, recorded on the source rather than thrown on. */
class SyncStopped extends Error {
  readonly reason: SourceSyncFailureReason

  constructor(reason: SourceSyncFailureReason, message: string) {
    super(message)
    this.name = 'SyncStopped'
    this.reason = reason
  }
}

/**
 * One revision to publish: a replayed one; the whole head as one revision; or
 * a re-plan of the newest revision, when the layout changed and no revision did.
 */
type Step =
  | { readonly kind: 'replay'; readonly revision: SourceRevision }
  | { readonly kind: 'snapshot'; readonly revision: SourceRevision; readonly note: string }
  | { readonly kind: 'replan'; readonly revision: SourceRevision; readonly note: string }

/** What one document does in a revision, once the source's changes are read. */
type DocumentEdit =
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

type WriteEdit = Extract<DocumentEdit, { kind: 'write' }>
/** An edit the store sees: a write, a move or a delete. */
type ContentEdit = Extract<DocumentEdit, { kind: 'write' | 'archive' }>
type PlacedEdit = Extract<DocumentEdit, { kind: 'write' | 'place' }>

/** A file the revision stores or places, before its contents are read. */
interface Wanted {
  readonly file: SourceFile
  readonly fromPath: string | null
  /** Already stored as it is: only its place in the tree is decided again. */
  readonly placeOnly: boolean
}

/** A layout's collections as rows of the workspace, and what must change for them. */
interface Resolution {
  readonly fingerprint: string
  readonly ids: ReadonlyMap<LayoutCollection, CollectionId>
  /** Written in the next revision's transaction, then cleared. */
  create: readonly { readonly id: CollectionId; readonly slug: string; readonly name: string }[]
  rename: readonly { readonly id: CollectionId; readonly from: string; readonly to: string }[]
}

class SourceReplay {
  readonly #deps: SyncSourceDependencies
  readonly #workspaceId: WorkspaceId
  readonly #source: ConnectedSource
  /** The source revision being replayed, named in a failure. */
  #current: SourceRevisionId | null = null
  /** The files not stored, by path: kept from earlier syncs until a later revision stores or removes them. */
  #refused = new Map<string, RefusedSourceFile>()
  /** What the tree was last placed by; null when that was never recorded, which re-plans it. */
  #record: SourceLayoutRecord | null = null
  /**
   * The broken links the last sync found, by document path; null when no
   * sync has checked every document's links since they last changed, which
   * checks them all.
   */
  #broken: ReadonlyMap<string, readonly BrokenSourceLink[]> | null = null
  /** The documents this sync wrote or archived, whose links, and links to which, are checked again. */
  readonly #written = new Set<DocumentId>()
  readonly #archived = new Set<DocumentId>()
  /** Whether a revision was skipped as already recorded, whose assets are then reconciled at the head. */
  #resumed = false
  /** The head's layout, which every re-plan with no layout of its own revision uses. */
  #headLayout: SourceLayout
  /** The layout of the revision last replayed; null when it must be read again. */
  #layout: SourceLayout | null = null
  #resolution: Resolution | null = null
  #placer: { readonly fingerprint: string; readonly placer: LayoutPlacer } | null = null
  #workspaceSlug: string | null = null

  constructor(deps: SyncSourceDependencies, workspaceId: WorkspaceId, source: ConnectedSource) {
    this.#deps = deps
    this.#workspaceId = workspaceId
    this.#source = source
    // What the head's layout is until its manifest is read.
    this.#headLayout = layoutFromSettings(source.settings.collections)
  }

  async run(): Promise<SyncSourceResult> {
    const { repos } = this.#deps.uow
    try {
      const state = await repos.sourceSyncState.find(this.#workspaceId)
      for (const refused of state?.refused ?? []) this.#refused.set(refused.path, refused)
      this.#record = state?.layout ?? null
      this.#broken = brokenByPath(state === null ? [] : state.brokenLinks)
      const last = state?.lastSyncedRevision ?? null

      const head = await this.#source.source.head()
      if (head === last && this.#layoutHolds()) return { kind: 'up-to-date', revision: head }

      const fetched = await this.#source.source.fetch()
      this.#current = fetched
      const headLayout = await this.#layoutAt(fetched)
      this.#headLayout = headLayout
      await this.#source.source.narrow(layoutPaths(headLayout))

      let steps = await this.#plan(last, fetched)
      if (steps.length === 0 && this.#record?.fingerprint !== headLayout.fingerprint) {
        steps = await this.#snapshot(fetched, 'replan', () => LAYOUT_CHANGED_SUMMARY)
      }
      let previous = last
      let published = 0
      for (const step of steps) {
        this.#current = step.revision.id
        if (await this.#apply(step, previous)) published += 1
        previous = step.revision.id
      }
      this.#current = fetched
      if (this.#resumed) await this.#reconcileAtHead(fetched)
      const broken = await this.#checkLinks(fetched)
      await this.#deps.uow.run((tx) => this.#recordSynced(tx, fetched, this.#record, broken))
      return { kind: 'synced', revision: fetched, published }
    } catch (error) {
      const failure = toFailure(error, this.#current)
      await repos.sourceSyncState.recordFailure({
        workspaceId: this.#workspaceId,
        failure,
        now: this.#deps.clock.now(),
      })
      // Something the job did not foresee is also the outbox's to retry.
      if (failure.reason === 'unexpected') throw error
      return { kind: 'failed', failure }
    }
  }

  /**
   * Whether the tree's layout is still the one it was placed by, when the
   * source has not moved. A manifest only changes with a revision, so only
   * the stored settings can have moved under a tree the settings placed.
   */
  #layoutHolds(): boolean {
    const record = this.#record
    if (record === null) return false
    return (
      record.origin === 'manifest' ||
      record.fingerprint === layoutFromSettings(this.#source.settings.collections).fingerprint
    )
  }

  /**
   * The revisions to publish, oldest first. A first sync that wants only the
   * head, and a branch rewritten under the last synced revision, both become
   * one revision of the whole head.
   */
  async #plan(last: SourceRevisionId | null, fetched: SourceRevisionId): Promise<readonly Step[]> {
    const { source, settings } = this.#source
    if (last === null && settings.history === 'head') {
      return await this.#snapshot(fetched, 'snapshot', (revision) => importedAtSummary(revision.id))
    }
    try {
      const revisions = await collect(source.history(last, fetched))
      return revisions.map((revision) => ({ kind: 'replay', revision }))
    } catch (error) {
      if (!(error instanceof ExternalSourceError) || error.reason !== 'history-rewritten') {
        throw error
      }
      return await this.#snapshot(fetched, 'snapshot', () => HISTORY_REWRITTEN_SUMMARY)
    }
  }

  /** The newest revision that changed the source, as one step; none when nothing ever did. */
  async #snapshot(
    fetched: SourceRevisionId,
    kind: 'snapshot' | 'replan',
    note: (revision: SourceRevision) => string,
  ): Promise<readonly Step[]> {
    const revisions = await collect(this.#source.source.history(null, fetched))
    const newest = revisions.at(-1)
    return newest === undefined ? [] : [{ kind, revision: newest, note: note(newest) }]
  }

  // -------------------------------------------------------------------------
  // The layout
  // -------------------------------------------------------------------------

  /** The head's layout; a manifest there that does not read stops the sync. */
  async #layoutAt(revision: SourceRevisionId): Promise<SourceLayout> {
    const read = await this.#readLayout(revision)
    if (read.ok) return read.layout
    throw new SyncStopped(
      'invalid-manifest',
      `${describeManifestProblem(SOURCE_MANIFEST_PATH, read.problem)} (at ${revision})`,
    )
  }

  /**
   * The layout a replayed revision is placed by. It is read again only when
   * the revision changes the manifest, or when nothing is known yet; a
   * manifest that does not read there keeps the layout before it.
   */
  async #layoutFor(step: Step, changes: readonly SourceChange[]): Promise<SourceLayout> {
    const head = this.#headLayout
    if (step.kind !== 'replay') {
      this.#layout = head
      return head
    }
    if (this.#layout === null || changes.some(touchesManifest)) {
      const read = await this.#readLayout(step.revision.id)
      this.#layout = read.ok ? read.layout : (this.#layout ?? head)
    }
    return this.#layout
  }

  async #readLayout(
    revision: SourceRevisionId,
  ): Promise<
    | { readonly ok: true; readonly layout: SourceLayout }
    | { readonly ok: false; readonly problem: ManifestProblem }
  > {
    const file = await this.#source.source.file(revision, SOURCE_MANIFEST_PATH)
    if (file === null) {
      return { ok: true, layout: layoutFromSettings(this.#source.settings.collections) }
    }
    if (file.kind === 'symbolic-link')
      return unreadable('it is a symbolic link, which is never followed.')
    const content = (await this.#read([file])).get(file.fileId)
    if (content === undefined) {
      throw new ExternalSourceError('file-missing', `The source did not return ${file.path}.`)
    }
    if (content.kind === 'too-large') return unreadable('it is larger than a source file may be.')
    const text = decodeUtf8(content.bytes)
    if (text === null) return unreadable('it is not UTF-8.')
    const parsed = parseSourceManifest(text)
    if (!parsed.ok) return parsed
    const entry = selectManifestEntry(parsed.manifest, await this.#slug())
    if (!entry.ok) return entry
    return { ok: true, layout: layoutFromManifest(entry.entry, parsed.manifest.unknownKeys) }
  }

  async #slug(): Promise<string> {
    if (this.#workspaceSlug === null) {
      const workspace = await this.#deps.uow.repos.workspaces.findById(this.#workspaceId)
      this.#workspaceSlug = workspace?.slug ?? ''
    }
    return this.#workspaceSlug
  }

  #placerFor(layout: SourceLayout): LayoutPlacer {
    if (this.#placer?.fingerprint !== layout.fingerprint) {
      this.#placer = { fingerprint: layout.fingerprint, placer: layoutPlacer(layout) }
    }
    return this.#placer.placer
  }

  /**
   * The layout's collections as the workspace's: a settings collection by
   * its id; a manifest's by its slug, renamed when its title changed, and
   * minted when the workspace has none with that slug. Read once per layout.
   */
  async #resolve(layout: SourceLayout): Promise<Resolution> {
    if (this.#resolution?.fingerprint === layout.fingerprint) return this.#resolution
    const ids = new Map<LayoutCollection, CollectionId>()
    const create: Resolution['create'][number][] = []
    const rename: Resolution['rename'][number][] = []
    const rows = new Map(
      (await this.#deps.uow.repos.collections.listByWorkspace(this.#workspaceId)).map((row) => [
        row.slug,
        row,
      ]),
    )
    for (const collection of layout.collections) {
      if (collection.from === 'settings') {
        ids.set(collection, collection.collectionId)
        continue
      }
      const row = rows.get(collection.slug)
      if (row === undefined) {
        const id = toCollectionId(this.#deps.ids.uuid())
        create.push({ id, slug: collection.slug, name: collection.title })
        ids.set(collection, id)
      } else {
        if (row.name !== collection.title) {
          rename.push({ id: row.id, from: row.name, to: collection.title })
        }
        ids.set(collection, row.id)
      }
    }
    this.#resolution = { fingerprint: layout.fingerprint, ids, create, rename }
    return this.#resolution
  }

  // -------------------------------------------------------------------------
  // One revision
  // -------------------------------------------------------------------------

  /** Publishes and records one step. True when it published a revision. */
  async #apply(step: Step, previous: SourceRevisionId | null): Promise<boolean> {
    const { repos } = this.#deps.uow
    const { revision } = step
    if (step.kind === 'replay') {
      const recorded = await repos.revisions.findBySourceRevision(this.#workspaceId, revision.id)
      if (recorded !== null) {
        // Its own transaction recorded its layout; read the next one afresh.
        this.#layout = null
        this.#resumed = true
        await this.#deps.uow.run((tx) => this.#recordSynced(tx, revision.id))
        return false
      }
    }

    const paths = new Map(
      (await repos.sourcePaths.listByWorkspace(this.#workspaceId)).map((row) => [row.path, row]),
    )
    const changes = await this.#changes(step, previous, paths)
    const layout = await this.#layoutFor(step, changes)
    const replan = step.kind !== 'replay' || this.#record?.fingerprint !== layout.fingerprint
    const resolution = await this.#resolve(layout)
    const edits = await this.#edits({ changes, revision: revision.id, paths, layout, replan })
    const content = edits.filter((edit): edit is ContentEdit => edit.kind !== 'place')
    const pending = resolution.create.length > 0 || resolution.rename.length > 0
    const assets = await this.#assets(revision.id, changes, layout, replan)
    if (edits.length === 0 && !replan && !pending && isEmpty(assets)) {
      await this.#deps.uow.run((tx) => this.#recordSynced(tx, revision.id))
      return false
    }

    const now = this.#deps.clock.now()
    // A forge's clock can run ahead of ours, and the store refuses a time in
    // its future: such a revision is stamped with our time, and its own date
    // stays readable from the source revision it names.
    const authoredAt =
      revision.committedAt.getTime() > now.getTime() + AUTHORED_AT_MAX_SKEW_MS
        ? now
        : revision.committedAt
    if (!isEmpty(assets)) await this.#storeAssetMap(revision, assets)
    const published = content.length === 0 ? null : await this.#publish(step, content, authoredAt)

    const record = recordOf(layout, resolution)
    await this.#deps.uow.run(async (tx) => {
      await this.#placeCollections(tx, resolution, now)
      const touched = new Set<CollectionId | null>()
      const context: RecordContext = {
        revision: published,
        source: revision,
        authoredAt,
        changeNote: step.kind === 'replay' ? (this.#changeNote(revision) ?? null) : step.note,
        paths,
        touched,
        now,
      }
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's client runs one statement at a time, and a move must free its path before a write takes it
      for (const edit of edits) await this.#recordEdit(tx, edit, context)
      const arranged = replan ? new Set<CollectionId | null>(resolution.ids.values()) : touched
      await this.#arrange(tx, resolution, arranged, sortOrders(paths, edits), now)
      if (replan) await this.#retire(tx, resolution, now)
      await this.#recordAssets(tx, assets, now)
      await this.#recordSynced(tx, revision.id, record)
    })
    resolution.create = []
    resolution.rename = []
    this.#record = record
    return published !== null
  }

  /** What changed in a step: the source's changes, a snapshot's whole tree, or nothing for a re-plan. */
  async #changes(
    step: Step,
    previous: SourceRevisionId | null,
    paths: ReadonlyMap<string, SourcePathRow>,
  ): Promise<readonly SourceChange[]> {
    if (step.kind === 'replay') {
      return await collect(this.#source.source.changes(previous, step.revision.id))
    }
    return step.kind === 'snapshot' ? await this.#snapshotChanges(step.revision.id, paths) : []
  }

  async #publish(
    step: Step,
    content: readonly ContentEdit[],
    authoredAt: Date,
  ): Promise<RevisionId> {
    const { revision } = step
    const problem = checkSourceStamp(
      { authoredAt, sourceRevision: revision.id },
      this.#deps.clock.now(),
    )
    if (problem !== null) {
      throw new SyncStopped('store-refused', `The store cannot record this revision: ${problem}`)
    }
    const changeNote = step.kind === 'replay' ? this.#changeNote(revision) : step.note
    const base = await this.#deps.contentStore.head(this.#workspaceId)
    const result = await this.#deps.contentStore.publish({
      workspaceId: this.#workspaceId,
      changes: content.map(toContentChange),
      author: revision.author,
      base,
      authoredAt,
      sourceRevision: revision.id,
      ...(changeNote === undefined ? {} : { changeNote }),
    })
    if (result.kind === 'merge-required') {
      throw new SyncStopped(
        'store-moved',
        'The workspace changed while its source was being replayed, so the revision was not published.',
      )
    }
    return result.revision
  }

  #changeNote(revision: SourceRevision): string | undefined {
    if (this.#source.settings.commitMessages === 'none') return undefined
    return revision.subject.length === 0 ? undefined : revision.subject
  }

  /** Every file at the head as added, and every path the workspace holds that the head lacks as removed. */
  async #snapshotChanges(
    revision: SourceRevisionId,
    paths: ReadonlyMap<string, SourcePathRow>,
  ): Promise<readonly SourceChange[]> {
    const added: SourceChange[] = []
    const present = new Set<string>()
    for await (const file of this.#source.source.files(revision)) {
      present.add(file.path)
      added.push({ kind: 'added', file })
    }
    const removed = [...paths.values()]
      .filter((row) => row.archivedAt === null && !present.has(row.path))
      .map((row): SourceChange => ({ kind: 'removed', path: row.path }))
    return [...added, ...removed]
  }

  /**
   * The source's changes as document edits: ids minted at first sight,
   * contents read and stamped, each file placed in its collection. A re-plan
   * also places every other file of the revision again, adds those the
   * layout now takes in, and archives those it leaves out.
   */
  async #edits(input: {
    readonly changes: readonly SourceChange[]
    readonly revision: SourceRevisionId
    readonly paths: ReadonlyMap<string, SourcePathRow>
    readonly layout: SourceLayout
    readonly replan: boolean
  }): Promise<readonly DocumentEdit[]> {
    const { revision, paths, layout } = input
    const changes = withRedirects(input.changes, layout.redirects, paths)
    const live = (path: string): SourcePathRow | null => {
      const row = paths.get(path)
      return row === undefined || row.archivedAt !== null ? null : row
    }
    const wanted: Wanted[] = []
    const archived: DocumentEdit[] = []
    const archive = (path: string): void => {
      this.#refused.delete(path)
      const row = live(path)
      if (row !== null && !archived.some((edit) => edit.path === path)) {
        archived.push({ kind: 'archive', documentId: row.documentId, path })
      }
    }

    for (const change of changes) {
      if (change.kind === 'removed') {
        archive(change.path)
      } else if (change.kind === 'renamed') {
        this.#refused.delete(change.fromPath)
        const from = isDocumentPath(change.fromPath) ? live(change.fromPath) : null
        if (!isDocumentPath(change.file.path)) archive(change.fromPath)
        else {
          wanted.push({
            file: change.file,
            fromPath: from === null ? null : change.fromPath,
            placeOnly: false,
          })
        }
      } else if (isDocumentPath(change.file.path)) {
        wanted.push({ file: change.file, fromPath: null, placeOnly: false })
      }
    }
    if (input.replan) await this.#replanned(revision, changes, wanted, archive, paths)

    const vacated = new Set(wanted.flatMap(({ fromPath }) => (fromPath === null ? [] : [fromPath])))
    // A file that cannot be stored is listed, and a document renamed into
    // one leaves its old path rather than staying where the source no longer
    // has it. A file the layout leaves out is not stored, and leaves.
    const { ids } = await this.#resolve(layout)
    const accepted: (Wanted & { readonly collectionId: CollectionId })[] = []
    for (const item of wanted) {
      const verdict = this.#accept(item.file, revision, layout, ids)
      if (verdict === 'unplaced') {
        this.#refused.delete(item.file.path)
        archive(item.fromPath ?? item.file.path)
      } else if (verdict === 'refused') {
        if (item.fromPath !== null) archive(item.fromPath)
      } else {
        accepted.push({ ...item, collectionId: verdict.collectionId })
      }
    }
    const contents = await this.#read(accepted.map(({ file }) => file))
    const placed: PlacedEdit[] = []
    for (const { file, fromPath, collectionId, placeOnly } of accepted) {
      const markdown = this.#decode(file, contents, revision)
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
        (this.#deps.ids.uuid() as DocumentId)
      const stamped = this.#deps.format.stampIdentity(markdown, documentId)
      const view = this.#deps.format.read(stamped)
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
              markdown: stamped,
              title,
              order,
              images: this.#imagePaths(file.path, stamped),
            },
      )
      this.#refused.delete(file.path)
    }
    // Moves first, so a path a rename leaves is free for a file added there in
    // the same revision.
    const moves = placed.filter((edit) => edit.kind === 'write' && edit.fromPath !== null)
    const rest = placed.filter((edit) => edit.kind !== 'write' || edit.fromPath === null)
    return [...archived, ...moves, ...rest]
  }

  /**
   * A re-plan reads the revision's whole tree: a file the changes did not
   * name is added when the workspace does not hold it, and placed again when
   * it does; a document whose file is gone from the tree leaves.
   */
  async #replanned(
    revision: SourceRevisionId,
    changes: readonly SourceChange[],
    wanted: Wanted[],
    archive: (path: string) => void,
    paths: ReadonlyMap<string, SourcePathRow>,
  ): Promise<void> {
    const handled = new Set(changes.flatMap(changedPaths))
    const present = new Set<string>()
    for await (const file of this.#source.source.files(revision)) {
      present.add(file.path)
      if (handled.has(file.path) || !isDocumentPath(file.path)) continue
      const held = paths.get(file.path)?.archivedAt === null
      wanted.push({ file, fromPath: null, placeOnly: held })
    }
    for (const row of paths.values()) {
      if (row.archivedAt === null && !present.has(row.path) && !handled.has(row.path)) {
        archive(row.path)
      }
    }
  }

  /** The collection a file is placed in; `unplaced` when the layout leaves it out; `refused` (and listed) when it cannot be stored. */
  #accept(
    file: SourceFile,
    revision: SourceRevisionId,
    layout: SourceLayout,
    ids: Resolution['ids'],
  ): { readonly collectionId: CollectionId } | 'unplaced' | 'refused' {
    const collection = this.#placerFor(layout).place(file.path)
    if (collection === null) return 'unplaced'
    if (file.kind === 'symbolic-link') {
      this.#refuse(file.path, revision, 'symbolic-link')
      return 'refused'
    }
    const collectionId = ids.get(collection)
    /* v8 ignore next -- every collection of a layout is resolved with it. */
    if (collectionId === undefined)
      throw new Error(`No collection resolved for ${collection.path}.`)
    return { collectionId }
  }

  #decode(
    file: SourceFile,
    contents: ReadonlyMap<string, SourceFileContent>,
    revision: SourceRevisionId,
  ): string | null {
    const content = contents.get(file.fileId)
    if (content === undefined) {
      throw new ExternalSourceError('file-missing', `The source did not return ${file.path}.`)
    }
    if (content.kind === 'too-large') return this.#refuse(file.path, revision, 'too-large')
    const text = decodeUtf8(content.bytes)
    return text ?? this.#refuse(file.path, revision, 'not-utf8')
  }

  #refuse(path: string, revision: SourceRevisionId, reason: RefusedSourceFile['reason']): null {
    this.#refused.set(path, { path, revision, reason })
    return null
  }

  async #read(files: readonly SourceFile[]): Promise<ReadonlyMap<string, SourceFileContent>> {
    const contents = new Map<string, SourceFileContent>()
    if (files.length === 0) return contents
    for await (const content of this.#source.source.readFiles(files.map((file) => file.fileId))) {
      contents.set(content.fileId, content)
    }
    return contents
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /** The layout's new collections, and its new titles for existing ones, before any document is placed in them. */
  async #placeCollections(tx: RepositoryBundle, resolution: Resolution, now: Date): Promise<void> {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's writes, in the manifest's order
    for (const { id, slug, name } of resolution.create) {
      await tx.collections.create({ id, workspaceId: this.#workspaceId, name, slug, now })
    }
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's writes
    for (const { id, to } of resolution.rename) await tx.collections.rename(id, to)
  }

  /**
   * Retires the collections the manifest created and no longer names. Their
   * documents have left with their files in this same revision, so nothing
   * live is in them. A collection the stored settings name is the
   * administrator's, and stays.
   */
  async #retire(tx: RepositoryBundle, resolution: Resolution, now: Date): Promise<void> {
    const kept = new Set<string>([
      ...resolution.ids.values(),
      ...this.#source.settings.collections.map(({ collectionId: id }) => id),
    ])
    const retired = (this.#record?.collectionIds ?? []).filter((id) => !kept.has(id))
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's writes
    for (const id of retired) {
      if ((await tx.collections.findById(id)) === null) continue
      await tx.collections.delete(id)
      await tx.events.record(
        collectionDeleted,
        { collectionId: id, workspaceId: this.#workspaceId, deletedBy: null },
        now,
      )
    }
  }

  async #recordEdit(
    tx: RepositoryBundle,
    edit: DocumentEdit,
    context: RecordContext,
  ): Promise<void> {
    const { revision, source, authoredAt, changeNote, paths, touched, now } = context
    if (edit.kind === 'place') {
      const existing = await tx.documents.findById(edit.documentId)
      /* v8 ignore next -- a placed document is a live one, read in this revision. */
      if (existing === null) throw new Error(`No document ${edit.documentId} to place.`)
      touched.add(existing.collectionId)
      touched.add(edit.collectionId)
      await this.#update(tx, existing, edit, now)
      await tx.sourcePaths.put(
        {
          workspaceId: this.#workspaceId,
          path: edit.path,
          documentId: edit.documentId,
          archivedAt: null,
          order: edit.order,
        },
        now,
      )
      return
    }
    /* v8 ignore next -- a write or an archive is only recorded after its publish. */
    if (revision === null) throw new Error('A content edit is recorded with its revision.')

    let summary: string
    if (edit.kind === 'archive') {
      const row = await tx.documents.update(
        edit.documentId,
        { status: 'archived', updatedBy: null },
        now,
      )
      touched.add(row.collectionId)
      summary = row.title
      this.#archived.add(edit.documentId)
      await tx.sourcePaths.put(
        {
          workspaceId: this.#workspaceId,
          path: edit.path,
          documentId: edit.documentId,
          archivedAt: now,
          order: paths.get(edit.path)?.order ?? null,
        },
        now,
      )
    } else {
      const existing = await tx.documents.findById(edit.documentId)
      summary = edit.title
      if (existing !== null) touched.add(existing.collectionId)
      touched.add(edit.collectionId)
      await this.#displaceArchived(tx, edit, paths, now)
      const row =
        existing === null
          ? await this.#create(tx, edit, authoredAt)
          : await this.#update(tx, existing, edit, now)
      await tx.documents.update(row.id, { headRevision: revision }, now)
      this.#written.add(edit.documentId)
      if (edit.images.length > 0) {
        await tx.sourceAssetHistory.recordShown(this.#workspaceId, edit.documentId, edit.images)
      }
      if (edit.fromPath !== null) await tx.sourcePaths.remove(this.#workspaceId, edit.fromPath)
      await tx.sourcePaths.put(
        {
          workspaceId: this.#workspaceId,
          path: edit.path,
          documentId: edit.documentId,
          archivedAt: null,
          order: edit.order,
        },
        now,
      )
    }

    await tx.revisions.append({
      id: this.#deps.ids.uuid(),
      documentId: edit.documentId,
      workspaceId: this.#workspaceId,
      revision,
      authorName: source.author.name,
      authorEmail: source.author.email,
      authorUserId: null,
      timestamp: authoredAt,
      summary,
      changeNote,
      sourceRevision: source.id,
      now,
    })
    await tx.events.record(
      documentPublished,
      { documentId: edit.documentId, workspaceId: this.#workspaceId, revision, publishedBy: null },
      now,
    )
  }

  /**
   * A rename onto a path whose document was archived takes the path: the
   * moving document keeps its own id (ADR-061), and the archived one gives up
   * its path map entry and its path, so it can never come back at the path.
   */
  async #displaceArchived(
    tx: RepositoryBundle,
    edit: WriteEdit,
    paths: ReadonlyMap<string, SourcePathRow>,
    now: Date,
  ): Promise<void> {
    const holder = paths.get(edit.path)
    if (
      holder === undefined ||
      holder.archivedAt === null ||
      holder.documentId === edit.documentId
    ) {
      return
    }
    await tx.documents.update(holder.documentId, { path: archivedPath(holder.documentId) }, now)
  }

  /** A new document, created when the revision that first brought it was made, so `newest` and `oldest` mean that. */
  async #create(tx: RepositoryBundle, edit: WriteEdit, createdAt: Date): Promise<DocumentRow> {
    for (let attempt = 1; attempt <= MAX_SHORT_ID_ATTEMPTS; attempt++) {
      const outcome = await tx.documents.createIfAvailable({
        id: edit.documentId,
        shortId: this.#deps.ids.shortId() as ShortId,
        workspaceId: this.#workspaceId,
        collectionId: edit.collectionId,
        parentId: null,
        slug: namedSlug(edit.title),
        path: edit.path,
        title: edit.title,
        status: 'published',
        templateId: null,
        templateVersion: null,
        createdBy: null,
        now: createdAt,
      })
      if (outcome.kind === 'created') return outcome.document
      if (outcome.kind === 'path-taken') {
        throw new SyncStopped('unexpected', `Another document already holds ${edit.path}.`)
      }
    }
    throw new SyncStopped(
      'unexpected',
      `No free short key after ${MAX_SHORT_ID_ATTEMPTS} attempts for ${edit.path}.`,
    )
  }

  async #update(
    tx: RepositoryBundle,
    existing: DocumentRow,
    edit: PlacedEdit,
    now: Date,
  ): Promise<DocumentRow> {
    const unchanged =
      existing.path === edit.path &&
      existing.title === edit.title &&
      existing.collectionId === edit.collectionId &&
      existing.status === 'published'
    if (edit.kind === 'place' && unchanged) return existing
    const row = await tx.documents.update(
      existing.id,
      {
        path: edit.path,
        title: edit.title,
        slug: namedSlug(edit.title),
        collectionId: edit.collectionId,
        status: 'published',
        updatedBy: null,
      },
      now,
    )
    if (existing.title !== edit.title) {
      await tx.events.record(
        documentRenamed,
        {
          documentId: existing.id,
          workspaceId: this.#workspaceId,
          from: existing.title,
          to: edit.title,
        },
        now,
      )
    }
    if (existing.collectionId !== edit.collectionId) {
      await tx.events.record(
        documentMoved,
        {
          documentId: existing.id,
          workspaceId: this.#workspaceId,
          fromCollectionId: existing.collectionId,
          toCollectionId: edit.collectionId,
        },
        now,
      )
    }
    return row
  }

  /**
   * Projects each touched collection's order onto its documents' sort keys
   * (ADR-049), writing only the keys that moved.
   */
  async #arrange(
    tx: RepositoryBundle,
    resolution: Resolution,
    collections: ReadonlySet<CollectionId | null>,
    orders: ReadonlyMap<DocumentId, number | null>,
    now: Date,
  ): Promise<void> {
    const rules = new Map([...resolution.ids].map(([collection, id]) => [id, collection.order]))
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's client runs one statement at a time
    for (const [id, rule] of rules) {
      if (!collections.has(id)) continue
      const documents = (await tx.documents.listByCollection(id)).filter(
        (document) => document.status !== 'archived',
      )
      const projected = projectSortKeys(
        documents.map((document) => ({ ...document, order: orders.get(document.id) ?? null })),
        rule,
      )
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's client runs one statement at a time
      for (const { item, sortKey } of projected) {
        if (item.sortKey !== sortKey) await tx.documents.update(item.id, { sortKey }, now)
      }
    }
  }

  /**
   * Records how far the sync got. Until it ends, the broken links are
   * recorded as unchecked once anything was written or archived, so a sync
   * that stops part-way leaves the next one to check every document.
   */
  async #recordSynced(
    tx: RepositoryBundle,
    revision: SourceRevisionId,
    record: SourceLayoutRecord | null = this.#record,
    broken: readonly BrokenSourceLink[] | null = this.#unchecked(),
  ): Promise<void> {
    const layout = record ?? this.#unplacedRecord()
    await tx.sourceSyncState.recordSynced({
      workspaceId: this.#workspaceId,
      revision,
      refused: [...this.#refused.values()],
      layout,
      brokenLinks: broken,
      now: this.#deps.clock.now(),
    })
  }

  /** The broken links as they stand before this sync's check: unknown once it changed anything. */
  #unchecked(): readonly BrokenSourceLink[] | null {
    if (this.#broken === null || this.#written.size > 0 || this.#archived.size > 0) return null
    return [...this.#broken.values()].flat()
  }

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  /**
   * What a revision does to the source's assets (ADR-061, "Repository
   * assets"): each file the layout calls an asset that it adds or changes is
   * read and taken in through the upload's own intake, and each it removes,
   * or no longer calls an asset, leaves the asset map. A re-plan compares the
   * whole revision with the map. A file the map already holds with the same
   * contents is not read again. The answer carries the whole map as the
   * revision leaves it, which the store keeps with the revision.
   */
  async #assets(
    revision: SourceRevisionId,
    changes: readonly SourceChange[],
    layout: SourceLayout,
    replan: boolean,
  ): Promise<AssetChanges> {
    const mapped = new Map(
      (await this.#deps.uow.repos.sourceAssets.listByWorkspace(this.#workspaceId)).map((row) => [
        row.path,
        row,
      ]),
    )
    const isAsset = assetMatcher(layout, this.#placerFor(layout))
    const wanted = new Map<string, SourceFile>()
    const removed = new Set<string>()
    const leave = (path: string): void => {
      if (mapped.has(path)) removed.add(path)
    }
    if (replan) {
      const present = new Set<string>()
      for await (const file of this.#source.source.files(revision)) {
        present.add(file.path)
        if (isAsset(file.path)) wanted.set(file.path, file)
        else leave(file.path)
      }
      for (const path of mapped.keys()) if (!present.has(path)) leave(path)
    } else {
      for (const change of changes) {
        if (change.kind === 'removed') leave(change.path)
        else {
          if (change.kind === 'renamed') leave(change.fromPath)
          if (isAsset(change.file.path)) wanted.set(change.file.path, change.file)
          else leave(change.file.path)
        }
      }
    }
    const fresh = [...wanted.values()].filter(
      (file) => mapped.get(file.path)?.fileId !== file.fileId,
    )
    const imported = await this.#import(fresh, revision)
    const taken = new Set(imported.map(({ path }) => path))
    // A file refused leaves the map: it is drawn as its alternative text.
    for (const { path } of fresh) if (!taken.has(path)) leave(path)
    const map = new Map([...mapped].map(([path, row]) => [path, row.attachmentId]))
    for (const path of removed) map.delete(path)
    for (const { path, attachmentId } of imported) map.set(path, attachmentId)
    return { imported, removed: [...removed], map }
  }

  /** The repository paths a document's relative images point at. */
  #imagePaths(path: string, markdown: string): readonly string[] {
    const targets = this.#deps.format
      .links(markdown)
      .filter((link) => link.kind === 'image' && isRelativeDestination(link.url))
      .flatMap((link) => repositoryTarget(path, link.url)?.path ?? [])
    return [...new Set(targets)]
  }

  /** Each file read and taken in as an upload is; a file refused is listed
   * instead. Each is given the attachment that will hold its bytes now: the
   * source's existing one with the same bytes, or a new one made with the
   * revision, so the map the store keeps with the revision names it.
   */
  async #import(
    files: readonly SourceFile[],
    revision: SourceRevisionId,
  ): Promise<readonly ImportedAsset[]> {
    const readable = files.filter((file) => {
      if (file.kind !== 'symbolic-link') return true
      this.#refuse(file.path, revision, 'symbolic-link')
      return false
    })
    const contents = await this.#read(readable)
    const imported: ImportedAsset[] = []
    const made = new Map<string, string>()
    for (const file of readable) {
      const content = contents.get(file.fileId)
      if (content === undefined) {
        throw new ExternalSourceError('file-missing', `The source did not return ${file.path}.`)
      }
      if (content.kind === 'too-large') {
        this.#refuse(file.path, revision, 'too-large')
        continue
      }
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- one file's bytes at a time, so a revision of many large assets never holds them all
      const received = await receiveFile(this.#deps, {
        declaredContentType: declaredAssetType(file.path),
        body: once(content.bytes),
        maxBytes: this.#deps.maxAssetBytes,
      })
      if (received.kind !== 'received') {
        this.#refuse(file.path, revision, received.kind)
        continue
      }
      this.#refused.delete(file.path)
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- a later file of the revision reuses an earlier one's attachment
      const existing = await this.#deps.uow.repos.attachments.findSourceOwned(
        this.#workspaceId,
        received.sha256,
      )
      const attachmentId =
        existing?.id ?? made.get(received.sha256) ?? (this.#deps.ids.uuid() as string)
      const create = existing === null && !made.has(received.sha256)
      made.set(received.sha256, attachmentId)
      imported.push({ path: file.path, fileId: file.fileId, received, attachmentId, create })
    }
    return imported
  }

  /**
   * Keeps the asset map with the store's next revision (ADR-061): a stored
   * file the revision's publish carries forward, so every stored revision
   * holds the map it was synced with, and is rendered with the pictures it
   * had. Written before the revision's documents are published.
   */
  async #storeAssetMap(revision: SourceRevision, assets: AssetChanges): Promise<void> {
    const { contentStore } = this.#deps
    const current = await contentStore.readFile(this.#workspaceId, SOURCE_ASSET_MAP_PATH)
    const text = writeAssetMap(assets.map)
    if (current?.text === text) return
    const written = await contentStore.putFile({
      workspaceId: this.#workspaceId,
      path: SOURCE_ASSET_MAP_PATH,
      text,
      expected: current?.text ?? null,
      author: revision.author,
      summary: 'Repository assets',
    })
    if (written.kind === 'stale') {
      throw new SyncStopped(
        'store-moved',
        'The workspace changed while its source was being replayed, so its assets were not recorded.',
      )
    }
  }

  /**
   * The asset map as a revision left it: an imported file's bytes become the
   * source's attachment holding them, made once per distinct content however
   * many paths and revisions carry it, and every path an attachment is held
   * at is remembered, for who may see it.
   */
  async #recordAssets(tx: RepositoryBundle, assets: AssetChanges, now: Date): Promise<void> {
    if (isEmpty(assets)) return
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's client runs one statement at a time
    for (const path of assets.removed) await tx.sourceAssets.remove(this.#workspaceId, path)
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's writes, in order
    for (const { path, fileId, received, attachmentId, create } of assets.imported) {
      if (create) {
        await tx.attachments.createForSource({
          id: attachmentId,
          workspaceId: this.#workspaceId,
          filename: safeFilename(assetFilename(path)),
          contentType: received.contentType,
          size: received.size,
          sha256: received.sha256,
          searchText: received.searchText,
          now,
        })
      }
      await tx.sourceAssets.put({ workspaceId: this.#workspaceId, path, attachmentId, fileId }, now)
      await tx.sourceAssetHistory.recordHeld(this.#workspaceId, path, attachmentId)
    }
  }

  /** The head's revision, whose author the reconciled map is written as. */
  async #reconcileAtHead(head: SourceRevisionId): Promise<void> {
    const revisions = await collect(this.#source.source.history(null, head))
    const newest = revisions.at(-1)
    /* v8 ignore next -- a resumed sync skipped a revision, so the source has one. */
    if (newest === undefined) return
    await this.#reconcileAssets(newest)
  }

  /**
   * After a replay that skipped revisions already recorded, whose assets it
   * did not read: the head's assets against the map, so an interrupted sync
   * misses none.
   */
  async #reconcileAssets(revision: SourceRevision): Promise<void> {
    const assets = await this.#assets(revision.id, [], this.#headLayout, true)
    if (isEmpty(assets)) return
    await this.#storeAssetMap(revision, assets)
    await this.#deps.uow.run((tx) => this.#recordAssets(tx, assets, this.#deps.clock.now()))
  }

  // -------------------------------------------------------------------------
  // Broken links
  // -------------------------------------------------------------------------

  /**
   * The relative links that lead nowhere in the repository at the fetched
   * revision (ADR-061, "Broken links are listed per commit"). The documents
   * this sync wrote are checked, with those listed as broken before (a path
   * they named may have appeared) and those linking to a document this sync
   * archived (it may have been their target). Every other document keeps
   * what was found before. When nothing says what was found before, every
   * document is checked.
   */
  async #checkLinks(revision: SourceRevisionId): Promise<readonly BrokenSourceLink[]> {
    const { repos } = this.#deps.uow
    const live = new Map(
      (await repos.sourcePaths.listByWorkspace(this.#workspaceId)).flatMap((row) =>
        row.archivedAt === null ? [[row.documentId, row.path] as const] : [],
      ),
    )
    const before = this.#broken
    const changed = this.#written.size > 0 || this.#archived.size > 0
    const checked =
      before === null
        ? new Set(live.keys())
        : changed
          ? await this.#toCheck(before, live)
          : new Set<DocumentId>()
    const found = await this.#relativeLinks(checked)
    const targets = new Set(found.flatMap(({ target }) => (target === null ? [] : [target])))
    // The repository's root is always there, and is no path to ask about.
    targets.delete('')
    const present =
      targets.size === 0
        ? new Set<string>()
        : await this.#source.source.present(revision, [...targets])
    const broken = found
      .filter(({ target }) => target === null || (target !== '' && !present.has(target)))
      .map(({ path, url }): BrokenSourceLink => ({ path, url, revision }))
    const kept = [...live]
      .filter(([id]) => !checked.has(id))
      .flatMap(([, path]) => before?.get(path) ?? [])
    return [...kept, ...broken].toSorted(
      (left, right) => left.path.localeCompare(right.path) || left.url.localeCompare(right.url),
    )
  }

  /** The live documents this sync wrote, those listed as broken before, and those that linked to one it archived. */
  async #toCheck(
    before: ReadonlyMap<string, readonly BrokenSourceLink[]>,
    live: ReadonlyMap<DocumentId, string>,
  ): Promise<ReadonlySet<DocumentId>> {
    const { documentLinks } = this.#deps.uow.repos
    const linking = await Promise.all(
      [...this.#archived].map((id) => documentLinks.listSourcesTargeting(id)),
    )
    const listed = [...live].flatMap(([id, path]) => (before.has(path) ? [id] : []))
    return new Set([...this.#written, ...listed, ...linking.flat()].filter((id) => live.has(id)))
  }

  /** Each relative link of these documents as stored at the head, and the repository path it names. */
  async #relativeLinks(ids: ReadonlySet<DocumentId>): Promise<readonly CheckedLink[]> {
    const found: CheckedLink[] = []
    const pending = [...ids]
    while (pending.length > 0) {
      const batch = pending.splice(0, LINK_CHECK_READS)
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- a batch at a time, so a large source never reads every document at once
      const sources = await Promise.all(
        batch.map((id) => this.#deps.contentStore.read(this.#workspaceId, id)),
      )
      for (const source of sources) {
        /* v8 ignore next -- a live document is stored at the head. */
        if (source === null) continue
        // The stored path is the source path (ADR-061).
        const { path } = source
        const urls = new Set(
          this.#deps.format
            .links(source.markdown)
            .map(({ url }) => url)
            .filter(isRelativeDestination),
        )
        for (const url of urls) {
          found.push({ path, url, target: repositoryTarget(path, url)?.path ?? null })
        }
      }
    }
    return found
  }

  /** What is recorded when no revision ever placed the tree: the head's layout, with no collections made. */
  #unplacedRecord(): SourceLayoutRecord {
    const layout = this.#headLayout
    return {
      origin: layout.origin,
      fingerprint: layout.fingerprint,
      collectionIds: [],
      unknownKeys: layout.unknownKeys,
    }
  }
}

/** An asset a revision imported: where it is, the source's id for its contents, and the bytes as stored. */
interface ImportedAsset {
  readonly path: string
  readonly fileId: string
  readonly received: Received
  /** The attachment that holds the bytes. */
  readonly attachmentId: string
  /** Whether that attachment is made with this revision, or already the source's. */
  readonly create: boolean
}

/** What a revision does to the asset map, and the map as it leaves it. */
interface AssetChanges {
  readonly imported: readonly ImportedAsset[]
  readonly removed: readonly string[]
  readonly map: ReadonlyMap<string, string>
}

function isEmpty(assets: AssetChanges): boolean {
  return assets.imported.length === 0 && assets.removed.length === 0
}

/** A file's bytes as the one chunk of a body. */
async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes
}

/** Documents read at once when their links are checked. */
const LINK_CHECK_READS = 16

/** A relative link of a document, and the repository path it names; null when it names none. */
interface CheckedLink {
  readonly path: string
  readonly url: string
  readonly target: string | null
}

/** Broken links by the document path they are in; null stays null: nothing was checked. */
function brokenByPath(
  links: readonly BrokenSourceLink[] | null,
): ReadonlyMap<string, readonly BrokenSourceLink[]> | null {
  if (links === null) return null
  const byPath = new Map<string, BrokenSourceLink[]>()
  for (const link of links) byPath.set(link.path, [...(byPath.get(link.path) ?? []), link])
  return byPath
}

interface RecordContext {
  /** The store revision the step published; null when it published nothing. */
  readonly revision: RevisionId | null
  readonly source: SourceRevision
  readonly authoredAt: Date
  readonly changeNote: string | null
  readonly paths: ReadonlyMap<string, SourcePathRow>
  /** The collections whose documents changed, for their sort keys. */
  readonly touched: Set<CollectionId | null>
  readonly now: Date
}

function unreadable(message: string) {
  return { ok: false, problem: { line: null, message } } as const
}

function recordOf(layout: SourceLayout, resolution: Resolution): SourceLayoutRecord {
  return {
    origin: layout.origin,
    fingerprint: layout.fingerprint,
    collectionIds: layout.origin === 'manifest' ? [...resolution.ids.values()] : [],
    unknownKeys: layout.unknownKeys,
  }
}

/** Each document's front matter `order`: as the path map held it, and as this step read it. */
function sortOrders(
  paths: ReadonlyMap<string, SourcePathRow>,
  edits: readonly DocumentEdit[],
): ReadonlyMap<DocumentId, number | null> {
  const orders = new Map<DocumentId, number | null>(
    [...paths.values()].map((row) => [row.documentId, row.order]),
  )
  for (const edit of edits) if (edit.kind !== 'archive') orders.set(edit.documentId, edit.order)
  return orders
}

function touchesManifest(change: SourceChange): boolean {
  return changedPaths(change).includes(SOURCE_MANIFEST_PATH)
}

function changedPaths(change: SourceChange): readonly string[] {
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

/** Where an archived document's row goes when a live one takes its path; never a store path. */
export function archivedPath(documentId: DocumentId): string {
  return `.${BRAND.slug}/archived/${documentId}.md`
}

/** An async iterable read to its end: a revision's history or changes are bounded and wanted whole. */
async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const item of items) all.push(item)
  return all
}

function toContentChange(edit: ContentEdit): ContentChange {
  if (edit.kind === 'archive') {
    return { kind: 'delete', documentId: edit.documentId, path: edit.path }
  }
  if (edit.fromPath !== null) {
    return {
      kind: 'move',
      documentId: edit.documentId,
      fromPath: edit.fromPath,
      toPath: edit.path,
      markdown: edit.markdown,
    }
  }
  return { kind: 'write', documentId: edit.documentId, path: edit.path, markdown: edit.markdown }
}

function toFailure(error: unknown, revision: SourceRevisionId | null): SourceSyncFailure {
  if (error instanceof ExternalSourceError || error instanceof SyncStopped) {
    return { reason: error.reason, message: error.message, revision }
  }
  return {
    reason: 'unexpected',
    message: error instanceof Error ? error.message : String(error),
    revision,
  }
}
