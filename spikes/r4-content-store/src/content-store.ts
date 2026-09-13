/**
 * The ADR-014 ContentStore, implemented on the hand-written object model.
 * Vocabulary above this line is documents, revisions and diffs only.
 */

import { diff3Merge, diffIndices } from 'node-diff3'
import {
  type CommitObject,
  type Identity,
  MODE_FILE,
  type ObjectStore,
  readCommit,
  readTrailers,
  resolvePath,
  setPath,
  type TreeEntry,
  writeBlob,
  writeCommit,
  decodeTree,
  MODE_TREE,
} from './git-core.ts'

export type RevisionId = string
export type DocumentId = string

export interface ContentChange {
  documentId: DocumentId
  /** Repository-relative path, e.g. `handbook/engineering/onboarding.md`. */
  path: string
  /** null deletes. */
  content: string | null
  /** Previous path, when this publish is a move or rename. */
  previousPath?: string
  title: string
  changeNote?: string
  author: { name: string; email: string }
}

export interface PublishResult {
  revision: RevisionId
  blob: string
  /** How many CAS attempts were needed. 1 means no contention. */
  attempts: number
}

export interface RevisionSummary {
  revision: RevisionId
  parent: RevisionId | null
  author: { name: string; email: string }
  when: number
  subject: string
  documentId: string | null
  changeNote: string | null
  blob: string | null
}

export interface ContentDiff {
  path: string
  hunks: Array<{ aStart: number; aLines: string[]; bStart: number; bLines: string[] }>
  added: number
  removed: number
}

const COMMITTER: Identity = {
  name: 'Quill',
  email: 'quill@quill.invalid',
  when: 0,
  tz: '+0000',
}

export interface ContentStoreOptions {
  ref?: string
  /** Injected for deterministic tests. */
  now?: () => number
  maxCasAttempts?: number
  /** Called between CAS retries; the bench uses it to count contention. */
  onRetry?: (attempt: number) => void
}

export class ContentStore {
  private store: ObjectStore
  private ref: string
  private now: () => number
  private maxCasAttempts: number
  private onRetry: ((attempt: number) => void) | undefined

  constructor(store: ObjectStore, options: ContentStoreOptions = {}) {
    this.store = store
    this.ref = options.ref ?? 'refs/heads/main'
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
    this.maxCasAttempts = options.maxCasAttempts ?? 20
    this.onRetry = options.onRetry
  }

  head(): Promise<string | null> {
    return this.store.readRef(this.ref)
  }

  // ------------------------------------------------------------- publish

  /**
   * ADR-014 step 4: write blob, rebuild the tree from the previous tree with
   * that blob replaced, write the commit, advance the ref with CAS, retry the
   * whole thing against the new tree when the ref moved.
   */
  async publish(change: ContentChange, base: RevisionId | null): Promise<PublishResult> {
    const blobOid =
      change.content === null
        ? null
        : await writeBlob(this.store, Buffer.from(change.content, 'utf8'))

    for (let attempt = 1; attempt <= this.maxCasAttempts; attempt++) {
      const head = await this.store.readRef(this.ref)

      if (attempt === 1 && base !== null && head !== null && base !== head) {
        // Stale base. ADR-015 says the caller must three-way merge first;
        // the store only reports it (see mergeMarkdown in merge.ts).
        // For the spike we allow it through when the document itself did not
        // change between base and head.
        const baseBlob = await this.blobAt(base, change.path)
        const headBlob = await this.blobAt(head, change.path)
        if (baseBlob !== headBlob) {
          throw new StaleBaseError(base, head, change.path, baseBlob, headBlob)
        }
      }

      const parentTree = head ? (await readCommit(this.store, head)).tree : null
      let newTree = await setPath(this.store, parentTree, change.path, blobOid, MODE_FILE)
      if (change.previousPath && change.previousPath !== change.path) {
        newTree = await setPath(this.store, newTree, change.previousPath, null)
      }

      const when = this.now()
      const commit: CommitObject = {
        tree: newTree,
        parents: head ? [head] : [],
        author: { name: change.author.name, email: change.author.email, when, tz: '+0000' },
        committer: { ...COMMITTER, when },
        message: buildMessage(change),
      }
      const oid = await writeCommit(this.store, commit)
      const ok = await this.store.casRef(this.ref, head, oid)
      if (ok) return { revision: oid, blob: blobOid ?? '', attempts: attempt }
      this.onRetry?.(attempt)
      // Jittered backoff. Without it, N concurrent publishers livelock: every
      // loser retries instantly, collides again, and the unlucky one starves.
      const ceiling = Math.min(2 ** attempt, 64)
      await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * ceiling)))
    }
    throw new Error(`publish: ref ${this.ref} kept moving after ${this.maxCasAttempts} attempts`)
  }

  // ---------------------------------------------------------------- read

  async read(path: string, revision?: RevisionId): Promise<string | null> {
    const rev = revision ?? (await this.store.readRef(this.ref))
    if (!rev) return null
    const blobOid = await this.blobAt(rev, path)
    if (!blobOid) return null
    const o = await this.store.read(blobOid)
    return o ? o.body.toString('utf8') : null
  }

  private async blobAt(revision: RevisionId, path: string): Promise<string | null> {
    const commit = await readCommit(this.store, revision)
    return await resolvePath(this.store, commit.tree, path)
  }

  // ------------------------------------------------------------- history

  /**
   * History for one path: walk first-parent from HEAD and keep commits where
   * the blob at `path` differs from the parent's. Cost is O(commits) commit
   * reads plus O(commits * depth) tree reads, which is why Quill keeps a
   * Postgres revisions index in front of it (ADR-015).
   */
  async history(
    path: string,
    options: { limit?: number; from?: RevisionId } = {},
  ): Promise<RevisionSummary[]> {
    const limit = options.limit ?? 50
    let cursor = options.from ?? (await this.store.readRef(this.ref))
    const out: RevisionSummary[] = []
    if (!cursor) return out
    let commit = await readCommit(this.store, cursor)
    let blob = await resolvePath(this.store, commit.tree, path)
    while (out.length < limit) {
      const parentOid = commit.parents[0] ?? null
      if (!parentOid) {
        if (blob !== null) out.push(summarise(cursor, commit, blob))
        break
      }
      const parent = await readCommit(this.store, parentOid)
      // Cheap short-circuit: an unchanged root tree cannot contain a change.
      const parentBlob =
        parent.tree === commit.tree ? blob : await resolvePath(this.store, parent.tree, path)
      if (blob !== parentBlob) out.push(summarise(cursor, commit, blob))
      cursor = parentOid
      commit = parent
      blob = parentBlob
    }
    return out
  }

  /**
   * History by document id, using only the `Quill-Document-Id` trailer.
   * One commit read per commit walked and zero tree reads. This is the path
   * that rebuilds the Postgres revisions index from the repository alone.
   */
  async historyByDocumentId(
    documentId: DocumentId,
    options: { limit?: number; scanLimit?: number } = {},
  ): Promise<RevisionSummary[]> {
    const limit = options.limit ?? 50
    const scanLimit = options.scanLimit ?? Number.POSITIVE_INFINITY
    let cursor = await this.store.readRef(this.ref)
    const out: RevisionSummary[] = []
    let scanned = 0
    while (cursor && out.length < limit && scanned < scanLimit) {
      const commit = await readCommit(this.store, cursor)
      scanned++
      const trailers = readTrailers(commit.message)
      if (trailers['Quill-Document-Id'] === documentId) {
        out.push(summarise(cursor, commit, null))
      }
      cursor = commit.parents[0] ?? null
    }
    return out
  }

  /** Walk every commit once, bucketing by document id. Index rebuild path. */
  async rebuildIndex(): Promise<Map<string, RevisionSummary[]>> {
    const index = new Map<string, RevisionSummary[]>()
    let cursor = await this.store.readRef(this.ref)
    while (cursor) {
      const commit = await readCommit(this.store, cursor)
      const trailers = readTrailers(commit.message)
      const id = trailers['Quill-Document-Id']
      if (id) {
        const list = index.get(id) ?? []
        list.push(summarise(cursor, commit, null))
        index.set(id, list)
      }
      cursor = commit.parents[0] ?? null
    }
    return index
  }

  // ---------------------------------------------------------------- diff

  async diff(a: RevisionId, b: RevisionId, path: string): Promise<ContentDiff> {
    const [ta, tb] = await Promise.all([this.read(path, a), this.read(path, b)])
    return diffText(path, ta ?? '', tb ?? '')
  }

  // ------------------------------------------------------------ listTree

  async listTree(revision?: RevisionId): Promise<string[]> {
    const rev = revision ?? (await this.store.readRef(this.ref))
    if (!rev) return []
    const commit = await readCommit(this.store, rev)
    const out: string[] = []
    const walk = async (oid: string, prefix: string): Promise<void> => {
      const o = await this.store.read(oid)
      if (!o) return
      for (const e of decodeTree(o.body) as TreeEntry[]) {
        if (e.mode === MODE_TREE) await walk(e.oid, `${prefix}${e.name}/`)
        else out.push(`${prefix}${e.name}`)
      }
    }
    await walk(commit.tree, '')
    return out
  }
}

export class StaleBaseError extends Error {
  base: string
  head: string
  path: string
  baseBlob: string | null
  headBlob: string | null
  constructor(
    base: string,
    head: string,
    path: string,
    baseBlob: string | null,
    headBlob: string | null,
  ) {
    super(`stale base ${base.slice(0, 8)} (head ${head.slice(0, 8)}) for ${path}`)
    this.name = 'StaleBaseError'
    this.base = base
    this.head = head
    this.path = path
    this.baseBlob = baseBlob
    this.headBlob = headBlob
  }
}

function summarise(oid: string, commit: CommitObject, blob: string | null): RevisionSummary {
  const trailers = readTrailers(commit.message)
  return {
    revision: oid,
    parent: commit.parents[0] ?? null,
    author: { name: commit.author.name, email: commit.author.email },
    when: commit.author.when,
    subject: commit.message.split('\n')[0] ?? '',
    documentId: trailers['Quill-Document-Id'] ?? null,
    changeNote: trailers['Quill-Change-Note'] ?? null,
    blob,
  }
}

/** Subject line from the title, body blank, then the machine-readable trailers. */
export function buildMessage(change: ContentChange): string {
  const verb = change.content === null ? 'Delete' : change.previousPath ? 'Move' : 'Update'
  const subject = `${verb} ${change.title}`
  const trailers = [`Quill-Document-Id: ${change.documentId}`]
  if (change.changeNote) {
    trailers.push(`Quill-Change-Note: ${change.changeNote.replace(/\r?\n/g, ' ')}`)
  }
  return `${subject}\n\n${trailers.join('\n')}\n`
}

export function diffText(path: string, a: string, b: string): ContentDiff {
  const al = a.length === 0 ? [] : a.split('\n')
  const bl = b.length === 0 ? [] : b.split('\n')
  const indices = diffIndices(al, bl)
  let added = 0
  let removed = 0
  const hunks = indices.map((h) => {
    const aLines = al.slice(h.buffer1[0], h.buffer1[0] + h.buffer1[1])
    const bLines = bl.slice(h.buffer2[0], h.buffer2[0] + h.buffer2[1])
    removed += aLines.length
    added += bLines.length
    return { aStart: h.buffer1[0], aLines, bStart: h.buffer2[0], bLines }
  })
  return { path, hunks, added, removed }
}

export function renderUnifiedish(d: ContentDiff): string {
  const out: string[] = [`--- a/${d.path}`, `+++ b/${d.path}`]
  for (const h of d.hunks) {
    out.push(`@@ -${h.aStart + 1},${h.aLines.length} +${h.bStart + 1},${h.bLines.length} @@`)
    for (const l of h.aLines) out.push(`-${l}`)
    for (const l of h.bLines) out.push(`+${l}`)
  }
  return out.join('\n')
}

export interface MergeResult {
  ok: boolean
  text: string
  conflicts: number
}

/** ADR-015 three-way merge of Markdown, line-based, via node-diff3. */
export function mergeMarkdown(base: string, ours: string, theirs: string): MergeResult {
  const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), {
    stringSeparator: undefined,
  })
  const out: string[] = []
  let conflicts = 0
  for (const region of regions) {
    if (region.ok) {
      out.push(...region.ok)
    } else if (region.conflict) {
      conflicts++
      out.push('<<<<<<< yours')
      out.push(...region.conflict.a)
      out.push('||||||| base')
      out.push(...region.conflict.o)
      out.push('=======')
      out.push(...region.conflict.b)
      out.push('>>>>>>> published')
    }
  }
  return { ok: conflicts === 0, text: out.join('\n'), conflicts }
}
