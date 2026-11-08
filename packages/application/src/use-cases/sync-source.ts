import { BRAND } from '@quill/brand'
import type { DocumentId, RevisionId, ShortId, WorkspaceId } from '@quill/domain'

import { AUTHORED_AT_MAX_SKEW_MS, checkSourceStamp } from '../ports/content-store.ts'
import type { ContentChange, ContentStore } from '../ports/content-store.ts'
import type { DocumentFormat } from '../ports/document-format.ts'
import { ExternalSourceError } from '../ports/external-source.ts'
import type {
  SourceChange,
  SourceFile,
  SourceFileContent,
  SourceRevision,
  SourceRevisionId,
} from '../ports/external-source.ts'
import type { DocumentRow, RepositoryBundle, UnitOfWork } from '../ports/persistence.ts'
import type {
  ConnectedSource,
  ExternalSourceProvider,
  RefusedSourceFile,
  SourcePathRow,
  SourceSyncFailure,
  SourceSyncFailureReason,
  SourceSyncLock,
} from '../ports/source-sync.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { MAX_SHORT_ID_ATTEMPTS } from './create-document.ts'
import { namedSlug } from './document-path.ts'
import {
  documentMoved,
  documentPublished,
  documentRenamed,
  parseSourceSyncRequested,
  sourceSyncRequested,
} from './events.ts'
import type { SourceSyncTrigger } from './events.ts'
import { collectionFor, decodeUtf8, isDocumentPath, titleFromPath } from './source-files.ts'

/**
 * The sync job of a sourced workspace (ADR-061): the one writer of its
 * content, and the one consumer of `SourceSyncRequested`.
 *
 * It is idempotent and single-flight. Holding the source's lock, it reads the
 * remote head and stops when that is the revision it last synced. Otherwise it
 * fetches and replays the source's main-line revisions, oldest first, each as
 * one publish of everything it changed, authored by the revision's author at
 * the time it reached the branch, with a compare-and-swap on the store's head.
 * Each revision's publish is recorded — documents, path map, revisions index,
 * events and how far the sync got — in one transaction, so a failure part-way
 * leaves the workspace at the last revision that synced and never empties it.
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

/** One revision to publish: a replayed one, or the whole head as one revision. */
type Step =
  | { readonly kind: 'replay'; readonly revision: SourceRevision }
  | { readonly kind: 'snapshot'; readonly revision: SourceRevision; readonly note: string }

/** What one document does in a revision, once the source's changes are read. */
type DocumentEdit =
  | {
      readonly kind: 'write'
      readonly documentId: DocumentId
      readonly collectionId: string
      readonly path: string
      readonly fromPath: string | null
      readonly markdown: string
      readonly title: string
    }
  | { readonly kind: 'archive'; readonly documentId: DocumentId; readonly path: string }

type WriteEdit = Extract<DocumentEdit, { kind: 'write' }>

/** A file the revision stores, before its contents are read. */
interface Wanted {
  readonly file: SourceFile
  readonly fromPath: string | null
}

class SourceReplay {
  readonly #deps: SyncSourceDependencies
  readonly #workspaceId: WorkspaceId
  readonly #source: ConnectedSource
  /** The source revision being replayed, named in a failure. */
  #current: SourceRevisionId | null = null
  /** The files not stored, by path: kept from earlier syncs until a later revision stores or removes them. */
  #refused = new Map<string, RefusedSourceFile>()

  constructor(deps: SyncSourceDependencies, workspaceId: WorkspaceId, source: ConnectedSource) {
    this.#deps = deps
    this.#workspaceId = workspaceId
    this.#source = source
  }

  async run(): Promise<SyncSourceResult> {
    const { repos } = this.#deps.uow
    try {
      const state = await repos.sourceSyncState.find(this.#workspaceId)
      for (const refused of state?.refused ?? []) this.#refused.set(refused.path, refused)
      const last = state?.lastSyncedRevision ?? null

      const head = await this.#source.source.head()
      if (head === last) return { kind: 'up-to-date', revision: head }

      const fetched = await this.#source.source.fetch()
      let previous = last
      let published = 0
      for (const step of await this.#plan(last, fetched)) {
        this.#current = step.revision.id
        if (await this.#apply(step, previous)) published += 1
        previous = step.revision.id
      }
      this.#current = fetched
      await this.#deps.uow.run((tx) => this.#recordSynced(tx, fetched))
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
   * The revisions to publish, oldest first. A first sync that wants only the
   * head, and a branch rewritten under the last synced revision, both become
   * one revision of the whole head.
   */
  async #plan(last: SourceRevisionId | null, fetched: SourceRevisionId): Promise<readonly Step[]> {
    const { source, settings } = this.#source
    if (last === null && settings.history === 'head') {
      return await this.#snapshot(fetched, (revision) => importedAtSummary(revision.id))
    }
    try {
      const revisions = await collect(source.history(last, fetched))
      return revisions.map((revision) => ({ kind: 'replay', revision }))
    } catch (error) {
      if (!(error instanceof ExternalSourceError) || error.reason !== 'history-rewritten') {
        throw error
      }
      return await this.#snapshot(fetched, () => HISTORY_REWRITTEN_SUMMARY)
    }
  }

  /** The newest revision that changed the source, as one step; none when nothing ever did. */
  async #snapshot(
    fetched: SourceRevisionId,
    note: (revision: SourceRevision) => string,
  ): Promise<readonly Step[]> {
    const revisions = await collect(this.#source.source.history(null, fetched))
    const newest = revisions.at(-1)
    return newest === undefined ? [] : [{ kind: 'snapshot', revision: newest, note: note(newest) }]
  }

  /** Publishes and records one step. True when it published a revision. */
  async #apply(step: Step, previous: SourceRevisionId | null): Promise<boolean> {
    const { repos } = this.#deps.uow
    const { revision } = step
    if (step.kind === 'replay') {
      const recorded = await repos.revisions.findBySourceRevision(this.#workspaceId, revision.id)
      if (recorded !== null) {
        await this.#deps.uow.run((tx) => this.#recordSynced(tx, revision.id))
        return false
      }
    }

    const paths = new Map(
      (await repos.sourcePaths.listByWorkspace(this.#workspaceId)).map((row) => [row.path, row]),
    )
    const changes =
      step.kind === 'replay'
        ? await collect(this.#source.source.changes(previous, revision.id))
        : await this.#snapshotChanges(revision.id, paths)
    const edits = await this.#edits(changes, revision.id, paths)
    if (edits.length === 0) {
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
    const problem = checkSourceStamp({ authoredAt, sourceRevision: revision.id }, now)
    if (problem !== null) {
      throw new SyncStopped('store-refused', `The store cannot record this revision: ${problem}`)
    }

    const changeNote = step.kind === 'snapshot' ? step.note : this.#changeNote(revision)
    const base = await this.#deps.contentStore.head(this.#workspaceId)
    const result = await this.#deps.contentStore.publish({
      workspaceId: this.#workspaceId,
      changes: edits.map(toContentChange),
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

    await this.#deps.uow.run(async (tx) => {
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's client runs one statement at a time, and a move must free its path before a write takes it
      for (const edit of edits) {
        await this.#recordEdit(tx, edit, {
          revision: result.revision,
          source: revision,
          authoredAt,
          changeNote: changeNote ?? null,
          paths,
          now,
        })
      }
      await this.#recordSynced(tx, revision.id)
    })
    return true
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

  /** The source's changes as document edits: ids minted at first sight, contents read and stamped. */
  async #edits(
    changes: readonly SourceChange[],
    revision: SourceRevisionId,
    paths: ReadonlyMap<string, SourcePathRow>,
  ): Promise<readonly DocumentEdit[]> {
    const live = (path: string): SourcePathRow | null => {
      const row = paths.get(path)
      return row === undefined || row.archivedAt !== null ? null : row
    }
    const wanted: Wanted[] = []
    const archived: DocumentEdit[] = []
    const archive = (path: string): void => {
      this.#refused.delete(path)
      const row = live(path)
      if (row !== null) archived.push({ kind: 'archive', documentId: row.documentId, path })
    }

    for (const change of changes) {
      if (change.kind === 'removed') {
        archive(change.path)
      } else if (change.kind === 'renamed') {
        this.#refused.delete(change.fromPath)
        const from = isDocumentPath(change.fromPath) ? live(change.fromPath) : null
        if (!isDocumentPath(change.file.path)) archive(change.fromPath)
        else wanted.push({ file: change.file, fromPath: from === null ? null : change.fromPath })
      } else if (isDocumentPath(change.file.path)) {
        wanted.push({ file: change.file, fromPath: null })
      }
    }

    const vacated = new Set(wanted.flatMap(({ fromPath }) => (fromPath === null ? [] : [fromPath])))
    // A file that cannot be stored is listed, and a document renamed into
    // one leaves its old path rather than staying where the source no longer
    // has it.
    const accepted: (Wanted & { readonly collectionId: string })[] = []
    for (const item of wanted) {
      const collectionId = this.#accept(item.file, revision)
      if (collectionId === null) {
        if (item.fromPath !== null) archive(item.fromPath)
      } else {
        accepted.push({ ...item, collectionId })
      }
    }
    const contents = await this.#read(accepted.map(({ file }) => file))
    const written: WriteEdit[] = []
    for (const { file, fromPath, collectionId } of accepted) {
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
      written.push({
        kind: 'write',
        documentId,
        collectionId,
        path: file.path,
        fromPath,
        markdown: stamped,
        title: this.#deps.format.read(stamped).title ?? titleFromPath(file.path),
      })
      this.#refused.delete(file.path)
    }
    // Moves first, so a path a rename leaves is free for a file added there in
    // the same revision.
    const moves = written.filter((edit) => edit.fromPath !== null)
    const writes = written.filter((edit) => edit.fromPath === null)
    return [...archived, ...moves, ...writes]
  }

  /** The collection a file is stored in, or null when it cannot be stored; a refusal is listed. */
  #accept(file: SourceFile, revision: SourceRevisionId): string | null {
    if (file.kind === 'symbolic-link') return this.#refuse(file.path, revision, 'symbolic-link')
    const collection = collectionFor(file.path, this.#source.settings.collections)
    if (collection === null) return this.#refuse(file.path, revision, 'outside-collections')
    return collection.collectionId
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

  async #recordEdit(
    tx: RepositoryBundle,
    edit: DocumentEdit,
    context: RecordContext,
  ): Promise<void> {
    const { revision, source, authoredAt, changeNote, paths, now } = context
    let summary: string
    if (edit.kind === 'archive') {
      const row = await tx.documents.update(
        edit.documentId,
        { status: 'archived', updatedBy: null },
        now,
      )
      summary = row.title
      await tx.sourcePaths.put(
        {
          workspaceId: this.#workspaceId,
          path: edit.path,
          documentId: edit.documentId,
          archivedAt: now,
        },
        now,
      )
    } else {
      const existing = await tx.documents.findById(edit.documentId)
      summary = edit.title
      await this.#displaceArchived(tx, edit, paths, now)
      const row =
        existing === null
          ? await this.#create(tx, edit, now)
          : await this.#update(tx, existing, edit, now)
      await tx.documents.update(row.id, { headRevision: revision }, now)
      if (edit.fromPath !== null) await tx.sourcePaths.remove(this.#workspaceId, edit.fromPath)
      await tx.sourcePaths.put(
        {
          workspaceId: this.#workspaceId,
          path: edit.path,
          documentId: edit.documentId,
          archivedAt: null,
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

  async #create(tx: RepositoryBundle, edit: WriteEdit, now: Date): Promise<DocumentRow> {
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
        now,
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
    edit: WriteEdit,
    now: Date,
  ): Promise<DocumentRow> {
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

  async #recordSynced(tx: RepositoryBundle, revision: SourceRevisionId): Promise<void> {
    await tx.sourceSyncState.recordSynced({
      workspaceId: this.#workspaceId,
      revision,
      refused: [...this.#refused.values()],
      now: this.#deps.clock.now(),
    })
  }
}

interface RecordContext {
  readonly revision: RevisionId
  readonly source: SourceRevision
  readonly authoredAt: Date
  readonly changeNote: string | null
  readonly paths: ReadonlyMap<string, SourcePathRow>
  readonly now: Date
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

function toContentChange(edit: DocumentEdit): ContentChange {
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
