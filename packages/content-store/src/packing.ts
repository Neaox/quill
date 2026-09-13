/**
 * The maintenance hook the operations layer calls (ADR-014, ADR-018, ADR-024).
 *
 * Publish latency is flat in document count and in history depth, but p95
 * degrades roughly six-fold per 20,000 unpacked revisions on the filesystem
 * backend. Packing restores it, so scheduled packing is an operational
 * requirement, not a nicety, and monitoring alerts on publish p95, not p50.
 *
 * Real packing is `git gc` run against the workspace's bare repository by the
 * operations layer; this package deliberately does not write packfiles. What it
 * provides is the contract and the discipline around it: the pass runs inside
 * {@link PackingHook.withRefLock}, which serialises it against this process's
 * publishes, checks the ref lock before starting and the ref itself afterwards,
 * and drops the cached packfiles once the work is done so the next read opens
 * whatever `git gc` left behind.
 *
 * What it does **not** do is hold a lock that an outside process would respect.
 * The `ObjectStore` port's only concurrency primitive is a compare-and-swap
 * (ADR-014), and a compare-and-swap cannot be held open: it is taken and
 * released in one step. So a `git gc` in an operator's shell, or a publish from
 * another server, is *detected* — `locked` comes back false when the ref moved
 * under the pass, and the pass should be run again later — not excluded. Reads
 * keep working throughout either way, because packed objects are read as
 * readily as loose ones.
 */

import type { RevisionId, WorkspaceId } from '@quill/domain'
import { revisionId } from '@quill/domain'
import { DEFAULT_REF } from './git-content-store.ts'
import { KeyedMutex } from './keyed-mutex.ts'
import type { ObjectStore, ObjectStoreProvider } from './object-store.ts'

export interface PackingResult {
  readonly workspaceId: WorkspaceId
  /** The revision the pass ran at, or null for an unborn workspace. */
  readonly revision: RevisionId | null
  /**
   * False when the ref was held when the pass began, or moved while it ran.
   * The work may have run anyway; what the caller learns is that the pass was
   * not alone and is worth repeating.
   */
  readonly locked: boolean
}

export interface PackingHook {
  /**
   * Run a maintenance pass over one workspace. Passes for a workspace are
   * serialised, and the pack cache is dropped afterwards whatever the work did.
   */
  withRefLock(workspaceId: WorkspaceId, work: () => Promise<void>): Promise<PackingResult>
}

/** A backend that caches packfiles and can be told to forget them. */
interface PackCacheOwner {
  invalidatePacks(): Promise<void>
}

function ownsPackCache(store: ObjectStore): store is ObjectStore & PackCacheOwner {
  return 'invalidatePacks' in store
}

/**
 * The reference pass: it takes the ref lock once, runs the caller's work, and
 * reports whether anything else moved the ref meanwhile. An operations layer
 * that shells out to `git gc` passes it as the work.
 */
export class RefLockPackingHook implements PackingHook {
  readonly #provider: ObjectStoreProvider
  readonly #ref: string
  readonly #passes = new KeyedMutex()

  constructor(provider: ObjectStoreProvider, ref: string = DEFAULT_REF) {
    this.#provider = provider
    this.#ref = ref
  }

  async withRefLock(workspaceId: WorkspaceId, work: () => Promise<void>): Promise<PackingResult> {
    return await this.#passes.run(workspaceId, () => this.#pass(workspaceId, work))
  }

  async #pass(workspaceId: WorkspaceId, work: () => Promise<void>): Promise<PackingResult> {
    const store = await this.#provider.forWorkspace(workspaceId)
    const head = await store.readRef(this.#ref)
    // An unborn workspace has nothing to pack and no ref to take.
    if (head === null) return { workspaceId, revision: null, locked: true }
    // Compare-and-swap to the value the ref already holds: it takes the lock,
    // proves nothing else holds it, and leaves the history untouched.
    if (!(await store.casRef(this.#ref, head, head))) {
      return { workspaceId, revision: revisionId(head), locked: false }
    }
    try {
      await work()
    } finally {
      if (ownsPackCache(store)) await store.invalidatePacks()
    }
    return {
      workspaceId,
      revision: revisionId(head),
      locked: (await store.readRef(this.#ref)) === head,
    }
  }
}
