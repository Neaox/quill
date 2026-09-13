/**
 * Typed Git object access over an {@link ObjectStore}, with a staging area.
 *
 * A publish builds a blob, one tree per directory on the path, and a commit
 * before it knows whether it will win the compare-and-swap. Staging them keeps
 * the whole publish to a single {@link ObjectStore.writeBatch}, and lets the
 * tree builder read back trees it has only just written.
 */

import type { ObjectEntry, ObjectStore } from '../object-store.ts'
import { decodeCommit, encodeCommit, type GitCommit } from './commit.ts'
import { GitObjectError, hashObject, parseObject, serialiseObject } from './objects.ts'
import type { GitObject, GitObjectType } from './objects.ts'
import { decodeTree, encodeTree, type GitTreeEntry } from './tree.ts'

export class GitRepository {
  readonly #store: ObjectStore
  readonly #staged = new Map<string, ObjectEntry>()

  constructor(store: ObjectStore) {
    this.#store = store
  }

  async readObject(oid: string): Promise<GitObject | null> {
    const staged = this.#staged.get(oid)
    if (staged !== undefined) return parseObject(staged.bytes)
    const bytes = await this.#store.read(oid)
    return bytes === null ? null : parseObject(bytes)
  }

  /** Stage an object and return the oid it will have. */
  stage(type: GitObjectType, body: Buffer): string {
    const oid = hashObject(type, body)
    if (!this.#staged.has(oid)) this.#staged.set(oid, { oid, bytes: serialiseObject(type, body) })
    return oid
  }

  stageBlob(content: string): string {
    return this.stage('blob', Buffer.from(content, 'utf8'))
  }

  stageTree(entries: readonly GitTreeEntry[]): string {
    return this.stage('tree', encodeTree(entries))
  }

  stageCommit(commit: GitCommit): string {
    return this.stage('commit', encodeCommit(commit))
  }

  /**
   * Write everything staged since the last flush, in one batch. The staging
   * area is cleared only once the write has resolved: a failed flush leaves
   * the objects staged, so a retry writes them rather than losing them.
   */
  async flush(): Promise<void> {
    if (this.#staged.size === 0) return
    const entries = [...this.#staged.values()]
    await this.#store.writeBatch(entries)
    this.#staged.clear()
  }

  async readTree(oid: string): Promise<GitTreeEntry[]> {
    return decodeTree(this.#require(await this.readObject(oid), oid, 'tree').body)
  }

  async readCommit(oid: string): Promise<GitCommit> {
    return decodeCommit(this.#require(await this.readObject(oid), oid, 'commit').body)
  }

  /**
   * The commit at `oid`, or null when there is no such object or it is not a
   * commit. A revision the caller named but the store does not have is an
   * absent revision, not a fault; malformed commit bytes still throw.
   */
  async findCommit(oid: string): Promise<GitCommit | null> {
    const object = await this.readObject(oid)
    return object === null || object.type !== 'commit' ? null : decodeCommit(object.body)
  }

  async readBlobText(oid: string): Promise<string> {
    return this.#require(await this.readObject(oid), oid, 'blob').body.toString('utf8')
  }

  #require(object: GitObject | null, oid: string, type: GitObjectType): GitObject {
    if (object === null) throw new GitObjectError(`Object ${oid} is missing`)
    if (object.type !== type)
      throw new GitObjectError(`Object ${oid} is a ${object.type}, not a ${type}`)
    return object
  }
}
