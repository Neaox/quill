/**
 * Where every document is, in one tree.
 *
 * A document's identity is the UUID in its front matter, never its path
 * (ADR-015), so finding one means reading documents until an id matches. Doing
 * that per read costs an inflate per Markdown blob, and a `diff` or a `history`
 * asks for the same tree several times over, so the answer is memoised.
 *
 * The memo is safe because a tree oid *is* its contents: the same oid can never
 * describe two different trees, so an entry can go stale only by being evicted.
 * It is bounded for the same reason the render cache is (ADR-031): a workspace
 * with thousands of revisions must not be able to pin them all in memory. This
 * is the tree-shaped cousin of the Postgres revisions index, not the index
 * itself — nothing here survives the process.
 */

import type { DocumentId } from '@quill/domain'
import { readDocumentId } from './document-front-matter.ts'
import type { GitRepository } from './git/git-repository.ts'
import { walkTree } from './git/tree-path.ts'

/** Where one document sits in one tree, and the blob that holds it. */
export interface DocumentLocation {
  readonly path: string
  readonly oid: string
}

export interface TreeDocuments {
  readonly byId: ReadonlyMap<DocumentId, DocumentLocation>
  readonly idByPath: ReadonlyMap<string, DocumentId>
}

/** Trees kept at once. A publish, a diff, and a history page touch a handful. */
export const DEFAULT_INDEX_CAPACITY = 32

const MARKDOWN_SUFFIX = '.md'

export class DocumentIndex {
  readonly #capacity: number
  /** Least-recently-used first: `Map` iterates in insertion order. */
  readonly #trees = new Map<string, TreeDocuments>()

  constructor(capacity: number = DEFAULT_INDEX_CAPACITY) {
    this.#capacity = capacity
  }

  /** Entries held, for tests and diagnostics. */
  get size(): number {
    return this.#trees.size
  }

  async of(repository: GitRepository, treeOid: string): Promise<TreeDocuments> {
    const cached = this.#trees.get(treeOid)
    if (cached !== undefined) {
      this.#trees.delete(treeOid)
      this.#trees.set(treeOid, cached)
      return cached
    }
    const documents = await scanTree(repository, treeOid)
    this.#trees.set(treeOid, documents)
    this.#evict()
    return documents
  }

  #evict(): void {
    for (const oldest of this.#trees.keys()) {
      if (this.#trees.size <= this.#capacity) break
      this.#trees.delete(oldest)
    }
  }
}

/**
 * One pass over the tree, reading every Markdown blob's front matter. The first
 * file to claim an id keeps it, so a copied document cannot take over the
 * original's identity.
 */
async function scanTree(repository: GitRepository, treeOid: string): Promise<TreeDocuments> {
  const byId = new Map<DocumentId, DocumentLocation>()
  const idByPath = new Map<string, DocumentId>()
  for await (const { path, entry } of walkTree(repository, treeOid)) {
    if (!path.endsWith(MARKDOWN_SUFFIX)) continue
    const id = readDocumentId(await repository.readBlobText(entry.oid))
    if (id === null) continue
    idByPath.set(path, id)
    if (!byId.has(id)) byId.set(id, { path, oid: entry.oid })
  }
  return { byId, idByPath }
}
