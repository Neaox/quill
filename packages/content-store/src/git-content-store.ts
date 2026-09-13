/**
 * The {@link ContentStore} port implemented on the Git object model
 * (ADR-014, ADR-015).
 *
 * Publish is the only write. It stages a blob, the trees on each changed path,
 * and one commit, then advances the workspace's ref with compare-and-swap.
 * Publishes for one workspace are serialised in this process ahead of that
 * compare-and-swap; a lost race is retried with jittered backoff, because an
 * immediate retry livelocks under eight concurrent publishers (research R4).
 */

import { setTimeout as sleep } from 'node:timers/promises'
import type {
  ContentAuthor,
  ContentChange,
  ContentDiff,
  ContentStore,
  DocumentSource,
  MergeConflict,
  Page,
  PublishResult,
  RevisionSummary,
  TreeEntry,
} from '@quill/application'
import { revisionId, type DocumentId, type RevisionId, type WorkspaceId } from '@quill/domain'
import { PRODUCT_EMAIL, PRODUCT_NAME } from './branding.ts'
import { buildCommitMessage } from './commit-message.ts'
import { changedDocumentIds, toRevisionSummary, walkCommits } from './commit-walk.ts'
import type { WalkedCommit } from './commit-walk.ts'
import { DocumentIndex, type TreeDocuments } from './document-index.ts'
import { UTC, type GitIdentity } from './git/commit.ts'
import { GitRepository } from './git/git-repository.ts'
import { parseContentPath, resolvePath, setPath, walkTree } from './git/tree-path.ts'
import { KeyedMutex } from './keyed-mutex.ts'
import type { ObjectStore, ObjectStoreProvider } from './object-store.ts'
import { threeWayMerge } from './three-way-merge.ts'
import { unifiedDiff } from './unified-diff.ts'

export class ContentStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentStoreError'
  }
}

/**
 * The port declares `PublishRequest` but its barrel does not re-export it yet,
 * so it is taken from the method that receives it. Swap this for a direct
 * import once the application package exports the name.
 */
export type PublishRequest = Parameters<ContentStore['publish']>[0]

/** A workspace has one branch, and this is it. */
export const DEFAULT_REF = 'refs/heads/main'

const MARKDOWN_SUFFIX = '.md'
const ASSET_DIRECTORY = 'assets'

/**
 * How many commits a history page walks before it gives up and hands back a
 * cursor. Without it, one document with a single old revision in a workspace of
 * 20,000 costs a full walk — 27.6 seconds in research R4 — which is why
 * ADR-014 makes the scan bound mandatory and puts the Postgres revisions index
 * in front of this path.
 */
export const DEFAULT_SCAN_LIMIT = 500

/** The page the port declares, plus the scan bound this implementation needs. */
export interface HistoryPage extends Page {
  /** Commits to examine, however few of them touch the document. */
  readonly scanLimit?: number
}

export interface HistorySlice {
  readonly revisions: readonly RevisionSummary[]
  /**
   * The revision a follow-up call should resume after, or null when the walk
   * reached the root. It is not null just because the page is full: a page cut
   * short by the scan budget carries the cursor that continues it.
   */
  readonly cursor: RevisionId | null
}

export interface GitContentStoreOptions {
  readonly provider: ObjectStoreProvider
  /** The clock, injected: a revision's timestamp is part of its identity. */
  readonly now: () => Date
  /** Jitter source, injected so backoff is deterministic in tests. */
  readonly random: () => number
  readonly ref?: string
  /** Compare-and-swap attempts before a publish gives up. */
  readonly maxPublishAttempts?: number
  readonly sleep?: (milliseconds: number) => Promise<void>
  /** Commits `history` examines when a page does not say. */
  readonly scanLimit?: number
  /** Trees whose document ids are memoised at once. */
  readonly indexCapacity?: number
}

const EMPTY_SLICE: HistorySlice = { revisions: [], cursor: null }

export class GitContentStore implements ContentStore {
  readonly #provider: ObjectStoreProvider
  readonly #ref: string
  readonly #now: () => Date
  readonly #maxPublishAttempts: number
  readonly #sleep: (milliseconds: number) => Promise<void>
  readonly #random: () => number
  readonly #scanLimit: number
  readonly #documents: DocumentIndex
  readonly #publishes = new KeyedMutex()

  constructor(options: GitContentStoreOptions) {
    this.#provider = options.provider
    this.#ref = options.ref ?? DEFAULT_REF
    this.#now = options.now
    this.#maxPublishAttempts = options.maxPublishAttempts ?? 20
    this.#sleep = options.sleep ?? sleep
    this.#random = options.random
    this.#scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT
    this.#documents = new DocumentIndex(options.indexCapacity)
  }

  async head(workspaceId: WorkspaceId): Promise<RevisionId | null> {
    const store = await this.#provider.forWorkspace(workspaceId)
    const oid = await store.readRef(this.#ref)
    return oid === null ? null : revisionId(oid)
  }

  async read(
    workspaceId: WorkspaceId,
    id: DocumentId,
    revision?: RevisionId,
  ): Promise<DocumentSource | null> {
    const store = await this.#provider.forWorkspace(workspaceId)
    const repository = new GitRepository(store)
    const at = await this.#resolveRevision(store, revision)
    if (at === null) return null
    const tree = (await repository.findCommit(at))?.tree
    if (tree === undefined) return null
    const found = await this.#findDocument(repository, tree, id)
    if (found === null) return null
    return { documentId: id, path: found.path, markdown: found.markdown, revision: revisionId(at) }
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const changes = request.changes.map(normaliseChange)
    if (changes.length === 0) throw new ContentStoreError('A publish must change something')
    return await this.#publishes.run(request.workspaceId, () => this.#publish(request, changes))
  }

  async history(
    workspaceId: WorkspaceId,
    id: DocumentId,
    page: HistoryPage,
  ): Promise<readonly RevisionSummary[]> {
    return (await this.historySlice(workspaceId, id, page)).revisions
  }

  /**
   * What `history` found, and where to resume. The port returns only the
   * revisions, because it is fronted by the revisions index; a caller reading
   * the repository directly — an index rebuild — needs the cursor as well.
   */
  async historySlice(
    workspaceId: WorkspaceId,
    id: DocumentId,
    page: HistoryPage,
  ): Promise<HistorySlice> {
    const limit = positive(page.limit, 'limit')
    const scanLimit = positive(page.scanLimit ?? this.#scanLimit, 'scan limit')
    const store = await this.#provider.forWorkspace(workspaceId)
    const repository = new GitRepository(store)
    const start = await this.#startOfPage(repository, store, page)
    if (start === null) return EMPTY_SLICE
    const tree = (await repository.findCommit(start))?.tree
    if (tree === undefined) return EMPTY_SLICE
    const path = (await this.#documents.of(repository, tree)).byId.get(id)?.path ?? null
    const revisions: RevisionSummary[] = []
    let cursor: RevisionId | null = null
    let scanned = 0
    for await (const walked of walkCommits(repository, start)) {
      scanned += 1
      cursor = walked.parent === null ? null : revisionId(walked.revision)
      if (await touchesDocument(repository, walked, id, path)) {
        revisions.push(toRevisionSummary(walked))
      }
      if (revisions.length === limit || scanned === scanLimit) break
    }
    return { revisions, cursor }
  }

  async diff(
    workspaceId: WorkspaceId,
    id: DocumentId,
    from: RevisionId | null,
    to: RevisionId,
  ): Promise<ContentDiff> {
    const before = from === null ? null : await this.read(workspaceId, id, from)
    const after = await this.read(workspaceId, id, to)
    const path = after?.path ?? before?.path ?? `${id}${MARKDOWN_SUFFIX}`
    const diff = unifiedDiff(path, before?.markdown ?? '', after?.markdown ?? '')
    return {
      documentId: id,
      from,
      to,
      unified: diff.text,
      added: diff.added,
      removed: diff.removed,
    }
  }

  async listTree(workspaceId: WorkspaceId, revision?: RevisionId): Promise<readonly TreeEntry[]> {
    const store = await this.#provider.forWorkspace(workspaceId)
    const repository = new GitRepository(store)
    const at = await this.#resolveRevision(store, revision)
    if (at === null) return []
    const tree = (await repository.findCommit(at))?.tree
    if (tree === undefined) return []
    const documents = await this.#documents.of(repository, tree)
    const entries: TreeEntry[] = []
    for await (const walked of walkTree(repository, tree)) {
      entries.push(describeEntry(walked.path, documents.idByPath.get(walked.path)))
    }
    return entries
  }

  async #publish(request: PublishRequest, changes: ContentChange[]): Promise<PublishResult> {
    const store = await this.#provider.forWorkspace(request.workspaceId)
    for (let attempt = 1; ; attempt++) {
      const repository = new GitRepository(store)
      const head = await store.readRef(this.#ref)
      let effective = changes
      if (head !== null && request.base !== head) {
        const outcome = await this.#mergeStale(repository, changes, request.base, head)
        if (outcome.kind === 'conflicted') {
          return {
            kind: 'merge-required',
            current: revisionId(head),
            conflicts: outcome.conflicts,
          }
        }
        effective = outcome.changes
      }
      const revision = repository.stageCommit({
        tree: await buildTree(repository, head, effective),
        parents: head === null ? [] : [head],
        ...this.#identities(request.author),
        message: buildCommitMessage({
          changes: effective,
          ...(request.summary === undefined ? {} : { summary: request.summary }),
          ...(request.changeNote === undefined ? {} : { changeNote: request.changeNote }),
        }),
      })
      await repository.flush()
      if (await store.casRef(this.#ref, head, revision)) {
        return { kind: 'published', revision: revisionId(revision) }
      }
      if (attempt >= this.#maxPublishAttempts) {
        throw new ContentStoreError(
          `Publish lost ${attempt} compare-and-swap races on ${this.#ref}`,
        )
      }
      await this.#sleep(1 + Math.floor(this.#random() * Math.min(2 ** attempt, 64)))
    }
  }

  /**
   * The caller's base is no longer the head, so someone published in between.
   * Each document is merged against the revision the two sides share (ADR-015);
   * one conflict stops the whole publish, because a revision is all or nothing.
   *
   * A base of null against a workspace that does have revisions, and a base the
   * store no longer holds, are both treated as *maximally* stale: the merge
   * runs against an empty ancestor, so anything already published survives as a
   * conflict rather than being silently overwritten (ADR-014).
   */
  async #mergeStale(
    repository: GitRepository,
    changes: readonly ContentChange[],
    base: RevisionId | null,
    head: string,
  ): Promise<MergeOutcome> {
    const headTree = (await repository.readCommit(head)).tree
    const headDocuments = await this.#documents.of(repository, headTree)
    const baseTree = base === null ? undefined : (await repository.findCommit(base))?.tree
    const baseDocuments =
      baseTree === undefined ? EMPTY_DOCUMENTS : await this.#documents.of(repository, baseTree)
    const merged: ContentChange[] = []
    const conflicts: MergeConflict[] = []
    for (const change of changes) {
      const outcome = await this.#reconcile(repository, change, headDocuments, baseDocuments)
      if (outcome.kind === 'conflict') conflicts.push(outcome.conflict)
      else merged.push(outcome.change)
    }
    return conflicts.length === 0
      ? { kind: 'merged', changes: merged }
      : { kind: 'conflicted', conflicts }
  }

  /** One change against what the head and the common ancestor say (ADR-015). */
  async #reconcile(
    repository: GitRepository,
    change: ContentChange,
    head: TreeDocuments,
    base: TreeDocuments,
  ): Promise<ChangeOutcome> {
    const theirs = await readDocument(repository, head, change.documentId)
    const ancestor = await readDocument(repository, base, change.documentId)
    // Their path wins when they moved the document: retargeting is what stops
    // our change adding a second copy of it under the path it used to have.
    const relocated = theirs === null ? change : retarget(change, theirs.path)
    if (change.kind === 'delete') {
      return theirs !== null && ancestor !== null && theirs.markdown !== ancestor.markdown
        ? conflictOf(change.documentId, theirs, '', ancestor.markdown)
        : { kind: 'change', change: relocated }
    }
    // A move that carries no content has nothing to merge; its path is already
    // pointed at wherever the document ended up.
    if (change.markdown === undefined) return { kind: 'change', change: relocated }
    if (theirs === null) {
      // They deleted a document we edited; only a human can choose between the
      // two intentions.
      return ancestor === null
        ? { kind: 'change', change: relocated }
        : conflictOf(
            change.documentId,
            { path: pathOf(change), markdown: '' },
            change.markdown,
            ancestor.markdown,
          )
    }
    if (theirs.markdown === change.markdown) return { kind: 'change', change: relocated }
    const common = ancestor === null ? '' : ancestor.markdown
    const outcome = threeWayMerge(common, change.markdown, theirs.markdown)
    if (!outcome.clean) {
      return conflictOf(change.documentId, theirs, change.markdown, common, outcome.text)
    }
    return { kind: 'change', change: edited(change, theirs.path, outcome.text) }
  }

  /** The user authors a revision; the product commits it (ADR-014). */
  #identities(author: ContentAuthor): { author: GitIdentity; committer: GitIdentity } {
    const when = Math.floor(this.#now().getTime() / 1000)
    return {
      author: { name: author.name, email: author.email, when, timezone: UTC },
      committer: { name: PRODUCT_NAME, email: PRODUCT_EMAIL, when, timezone: UTC },
    }
  }

  async #resolveRevision(store: ObjectStore, revision?: RevisionId): Promise<string | null> {
    return revision === undefined ? await store.readRef(this.#ref) : revision
  }

  async #findDocument(
    repository: GitRepository,
    treeOid: string,
    id: DocumentId,
  ): Promise<FoundDocument | null> {
    return await readDocument(repository, await this.#documents.of(repository, treeOid), id)
  }

  /** A cursor is the previous page's last revision; resume at its parent. */
  async #startOfPage(
    repository: GitRepository,
    store: ObjectStore,
    page: Page,
  ): Promise<string | null> {
    if (page.cursor === undefined) return await store.readRef(this.#ref)
    const commit = await repository.findCommit(revisionId(page.cursor))
    return commit === null ? null : (commit.parents.at(0) ?? null)
  }
}

/** A document as it stands in some revision. */
interface FoundDocument {
  readonly path: string
  readonly markdown: string
}

type MergeOutcome =
  | { readonly kind: 'merged'; readonly changes: ContentChange[] }
  | { readonly kind: 'conflicted'; readonly conflicts: MergeConflict[] }

/** The two kinds of change that carry Markdown, and so can need merging. */
type ContentEdit = Extract<ContentChange, { kind: 'write' | 'move' }>

type ChangeOutcome =
  | { readonly kind: 'change'; readonly change: ContentChange }
  | { readonly kind: 'conflict'; readonly conflict: MergeConflict }

const EMPTY_DOCUMENTS: TreeDocuments = { byId: new Map(), idByPath: new Map() }

function positive(value: number, what: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ContentStoreError(`A history ${what} must be a positive whole number, not ${value}`)
  }
  return value
}

async function readDocument(
  repository: GitRepository,
  documents: TreeDocuments,
  id: DocumentId,
): Promise<FoundDocument | null> {
  const found = documents.byId.get(id)
  if (found === undefined) return null
  return { path: found.path, markdown: await repository.readBlobText(found.oid) }
}

function pathOf(change: ContentChange): string {
  return change.kind === 'move' ? change.toPath : change.path
}

/** The same change, aimed at where the document actually is now. */
function retarget(change: ContentChange, path: string): ContentChange {
  return change.kind === 'move' ? { ...change, fromPath: path } : { ...change, path }
}

/** A change that carries content: aimed at where the document is, and merged. */
function edited(change: ContentEdit, path: string, markdown: string): ContentChange {
  return change.kind === 'move'
    ? { ...change, fromPath: path, markdown }
    : { ...change, path, markdown }
}

function conflictOf(
  documentId: DocumentId,
  theirs: FoundDocument,
  ours: string,
  base: string,
  conflicted?: string,
): ChangeOutcome {
  return {
    kind: 'conflict',
    conflict: {
      documentId,
      path: theirs.path,
      ours,
      theirs: theirs.markdown,
      base,
      conflicted: conflicted ?? threeWayMerge(base, ours, theirs.markdown).text,
    },
  }
}

function normaliseChange(change: ContentChange): ContentChange {
  switch (change.kind) {
    case 'write':
      return { ...change, path: parseContentPath(change.path).normalised }
    case 'move':
      return {
        ...change,
        fromPath: parseContentPath(change.fromPath).normalised,
        toPath: parseContentPath(change.toPath).normalised,
      }
    case 'delete':
      return { ...change, path: parseContentPath(change.path).normalised }
  }
}

/** Every change of one publish applied to the previous tree, in order. */
async function buildTree(
  repository: GitRepository,
  head: string | null,
  changes: readonly ContentChange[],
): Promise<string> {
  // An unborn workspace starts from the empty tree, which git knows too.
  let tree = head === null ? repository.stageTree([]) : (await repository.readCommit(head)).tree
  for (const change of changes) {
    switch (change.kind) {
      case 'write':
        tree = await setPath(repository, tree, change.path, repository.stageBlob(change.markdown))
        break
      case 'move': {
        const carried = await resolvePath(repository, tree, change.fromPath)
        const blob = change.markdown === undefined ? carried : repository.stageBlob(change.markdown)
        tree = await setPath(repository, tree, change.fromPath, null)
        if (blob !== null) tree = await setPath(repository, tree, change.toPath, blob)
        break
      }
      case 'delete':
        tree = await setPath(repository, tree, change.path, null)
        break
    }
  }
  return tree
}

function describeEntry(path: string, id: DocumentId | undefined): TreeEntry {
  if (!path.endsWith(MARKDOWN_SUFFIX)) {
    return { path, kind: path.split('/').includes(ASSET_DIRECTORY) ? 'asset' : 'other' }
  }
  return { path, kind: 'document', ...(id === undefined ? {} : { documentId: id }) }
}

/**
 * A commit belongs in a document's history when its trailers say so, or when
 * the blob at the document's path changed. The trailer answers for deletes,
 * moves, and bulk publishes; the path answers for commits that arrived from
 * outside through Git sync, without trailers.
 */
async function touchesDocument(
  repository: GitRepository,
  walked: WalkedCommit,
  id: DocumentId,
  path: string | null,
): Promise<boolean> {
  if (changedDocumentIds(walked.trailers).includes(id)) return true
  if (path === null) return false
  const blob = await resolvePath(repository, walked.commit.tree, path)
  if (walked.parent === null) return blob !== null
  const parentTree = (await repository.readCommit(walked.parent)).tree
  return blob !== (await resolvePath(repository, parentTree, path))
}
