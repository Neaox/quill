/**
 * Filesystem {@link ObjectStore}: a real bare repository, loose objects, and
 * the lockfile protocol for ref compare-and-swap — the same protocol the git
 * CLI uses, so a repository stays safe while an operator has a shell in it.
 *
 * Objects are read from loose files first and from packfiles second, so a
 * `git gc` (an operational requirement, ADR-014) never makes a workspace
 * unreadable. Only loose objects are written, and they are written the way git
 * writes them: into a temporary file that is flushed to the disk and then
 * renamed into place, so a process that dies mid-write leaves a stray
 * temporary file rather than a half-written object under a name that promises
 * the whole one.
 */

import { existsSync } from 'node:fs'
import {
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { deflate, inflate } from 'node:zlib'
import type { WorkspaceId } from '@quill/domain'
import { PRODUCT_EMAIL, PRODUCT_NAME } from '../branding.ts'
import { UTC } from '../git/commit.ts'
import { GitObjectError, hashSerialised, isObjectId, serialiseObject } from '../git/objects.ts'
import type { ObjectEntry, ObjectStore, ObjectStoreProvider } from '../object-store.ts'
import { errorCode, fileAge, isLockContention, renameWithRetry } from './contention.ts'
import { PackIndex } from './pack-index.ts'

const deflateAsync = promisify(deflate)
const inflateAsync = promisify(inflate)

export interface FilesystemObjectStoreOptions {
  /**
   * The clock, injected: a reflog entry is timestamped, and how old a lock
   * file is decides whether it is contention or a leak (ADR-021's clock rule).
   */
  readonly now: () => Date
  /** zlib level for loose objects; git's `core.compression` default is 1. */
  readonly compression?: number
  /** How long a `<ref>.lock` may exist before it is reported as leaked. */
  readonly staleLockMilliseconds?: number
}

const ZERO_OID = '0'.repeat(40)

/** `ref: refs/heads/main`, the one indirection a ref file may hold. */
const SYMREF_PREFIX = 'ref: '
const SYMREF_DEPTH = 5

/**
 * Names temporary objects apart within this process. With the process id it is
 * enough: no two live processes share one, and a file left by a dead process
 * that had this id is overwritten rather than collided with.
 */
let temporaries = 0

/** How many loose objects are written at once by one `writeBatch`. */
const WRITE_CONCURRENCY = 8

/**
 * A publish holds the ref lock for a few milliseconds. A minute of it is not
 * a slow publish, it is a process that died holding the lock.
 */
const DEFAULT_STALE_LOCK_MILLISECONDS = 60_000

/**
 * A `<ref>.lock` that has been there far longer than any publish takes.
 *
 * It is reported rather than removed, and it is deliberately distinguishable
 * from losing a compare-and-swap race, because the two need opposite answers:
 * a lost race is retried, and a leaked lock never clears on its own. Removing
 * it here would be guessing — the holder may be a `git` command in an
 * operator's shell that is merely slow — and guessing wrong means two writers
 * on one ref. An operator checks, then removes the file the error names.
 */
export class LeakedLockError extends Error {
  readonly path: string
  readonly ageMilliseconds: number

  constructor(path: string, ageMilliseconds: number) {
    super(
      `Ref lock ${path} has been held for ${Math.round(ageMilliseconds / 1000)}s. ` +
        'If no publish is running, the process that took it died; remove the file to recover.',
    )
    this.name = 'LeakedLockError'
    this.path = path
    this.ageMilliseconds = ageMilliseconds
  }
}

/** The packs of one repository, and what the pack directory looked like then. */
interface CachedPacks {
  readonly signature: string
  readonly packs: readonly PackIndex[]
}

export class FilesystemObjectStore implements ObjectStore {
  readonly gitdir: string
  readonly #compression: number
  readonly #now: () => Date
  readonly #staleLockMilliseconds: number
  readonly #preparedDirectories = new Set<string>()
  #packs: CachedPacks | null = null

  constructor(gitdir: string, options: FilesystemObjectStoreOptions) {
    this.gitdir = gitdir
    this.#compression = options.compression ?? 1
    this.#now = options.now
    this.#staleLockMilliseconds = options.staleLockMilliseconds ?? DEFAULT_STALE_LOCK_MILLISECONDS
  }

  /**
   * Create the bare-repository skeleton if it is not there already.
   *
   * Every file is written only when it is absent, because this runs on every
   * process start and an operator is entitled to edit `config` or `description`
   * in a repository Quill owns. Two processes creating the same repository at
   * once is harmless: they write identical bytes.
   */
  static async create(
    gitdir: string,
    options: FilesystemObjectStoreOptions,
  ): Promise<FilesystemObjectStore> {
    await mkdir(join(gitdir, 'objects', 'pack'), { recursive: true })
    await mkdir(join(gitdir, 'refs', 'heads'), { recursive: true })
    await writeIfAbsent(join(gitdir, 'HEAD'), 'ref: refs/heads/main\n')
    await writeIfAbsent(
      join(gitdir, 'config'),
      '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n',
    )
    await writeIfAbsent(join(gitdir, 'description'), `${PRODUCT_NAME} content store\n`)
    return new FilesystemObjectStore(gitdir, options)
  }

  /**
   * The stored bytes, verified against the name they were asked for. An object
   * whose bytes do not hash to its own id is corrupt however it got that way,
   * and a store that hands it back would spread the corruption into a tree.
   */
  async read(oid: string): Promise<Uint8Array | null> {
    const bytes = await this.#readLoose(oid)
    if (bytes !== null) return verified(oid, bytes)
    for (const pack of await this.#loadPacks()) {
      const object = await pack.read(oid)
      if (object !== null) return verified(oid, serialiseObject(object.type, object.body))
    }
    return null
  }

  async write(oid: string, bytes: Uint8Array): Promise<void> {
    const path = this.#loosePath(oid)
    await this.#prepare(dirname(path))
    const temporary = await this.#writeTemporary(
      await deflateAsync(bytes, { level: this.#compression }),
    )
    try {
      // Rename replaces whatever is there, so a truncated object left behind by
      // a process that died mid-write is repaired rather than kept forever.
      await renameWithRetry(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  /** Bounded, so a bulk import cannot open a file handle per object at once. */
  async writeBatch(entries: readonly ObjectEntry[]): Promise<void> {
    await inParallel(entries, WRITE_CONCURRENCY, (entry) => this.write(entry.oid, entry.bytes))
  }

  /** Answers from the loose path and the pack index, inflating nothing. */
  async has(oid: string): Promise<boolean> {
    if (existsSync(this.#loosePath(oid))) return true
    return (await this.#loadPacks()).some((pack) => pack.has(oid))
  }

  /**
   * The object id a ref holds, following symbolic refs such as `HEAD` and
   * falling back to `packed-refs`. An empty file is an unborn ref, not a ref
   * whose value is the empty string: git writes one while it is creating a ref.
   */
  async readRef(name: string): Promise<string | null> {
    return await this.#readRef(name, 0)
  }

  /**
   * The git lockfile protocol: create `<ref>.lock` exclusively, re-read the
   * ref under the lock, write, append the reflog, then rename the lock into
   * place. A failed compare-and-swap never writes, and only ever removes a
   * lock file it created itself.
   */
  async casRef(name: string, expected: string | null, next: string): Promise<boolean> {
    const path = join(this.gitdir, name)
    const lockPath = `${path}.lock`
    const handle = await this.#takeLock(lockPath)
    if (handle === null) return false
    let holding = true
    let closed = false
    try {
      if ((await this.readRef(name)) !== expected) return false
      await handle.writeFile(`${next}\n`)
      // git appends the reflog under the lock and before the rename, so a
      // reader can never see a ref ahead of its own log.
      if (expected !== next) await this.#appendReflog(name, expected, next)
      await handle.close()
      closed = true
      await renameWithRetry(lockPath, path)
      holding = false
      return true
    } finally {
      if (!closed) await handle.close()
      // Only ever our own lock: once the rename has happened the path belongs
      // to whoever created it next.
      if (holding) await rm(lockPath, { force: true })
    }
  }

  /** Release every packfile handle this store has open. */
  async close(): Promise<void> {
    await this.#closePacks()
  }

  /** Forget cached packfiles after `git gc` has run out of band. */
  async invalidatePacks(): Promise<void> {
    await this.#closePacks()
  }

  async #closePacks(): Promise<void> {
    const cached = this.#packs
    this.#packs = null
    if (cached !== null) await Promise.all(cached.packs.map((pack) => pack.close()))
  }

  async #readLoose(oid: string): Promise<Buffer | null> {
    try {
      return await inflateAsync(await readFile(this.#loosePath(oid)))
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
      return null
    }
  }

  async #writeTemporary(bytes: Buffer): Promise<string> {
    temporaries += 1
    // git's own spelling, so `git gc` prunes one this process leaves behind.
    const path = join(this.gitdir, 'objects', `tmp_obj_${process.pid}_${temporaries}`)
    const handle = await open(path, 'w')
    try {
      await handle.writeFile(bytes)
      // Without this the rename can land before the bytes do, and a power cut
      // between the two leaves a named object that is empty.
      await handle.sync()
    } finally {
      await handle.close()
    }
    return path
  }

  async #prepare(directory: string): Promise<void> {
    if (this.#preparedDirectories.has(directory)) return
    await mkdir(directory, { recursive: true })
    this.#preparedDirectories.add(directory)
  }

  #loosePath(oid: string): string {
    if (!isObjectId(oid)) throw new GitObjectError(`"${oid}" is not an object id`)
    return join(this.gitdir, 'objects', oid.slice(0, 2), oid.slice(2))
  }

  async #readRef(name: string, depth: number): Promise<string | null> {
    if (depth > SYMREF_DEPTH) return null
    const raw = await this.#readRefFile(name)
    if (raw === null) return await this.#readPackedRef(name)
    if (raw === '') return null
    if (!raw.startsWith(SYMREF_PREFIX)) return raw
    return await this.#readRef(raw.slice(SYMREF_PREFIX.length).trim(), depth + 1)
  }

  async #readRefFile(name: string): Promise<string | null> {
    try {
      return (await readFile(join(this.gitdir, name), 'utf8')).trim()
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
      return null
    }
  }

  async #readPackedRef(name: string): Promise<string | null> {
    let packed: string
    try {
      packed = await readFile(join(this.gitdir, 'packed-refs'), 'utf8')
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
      return null
    }
    for (const line of packed.split('\n')) {
      const space = line.indexOf(' ')
      if (space !== -1 && line.slice(space + 1) === name) return line.slice(0, space)
    }
    return null
  }

  /** The lock, or null when somebody else holds it. */
  async #takeLock(lockPath: string): Promise<FileHandle | null> {
    try {
      return await open(lockPath, 'wx')
    } catch (error) {
      if (!isLockContention(error, lockPath)) throw error
      await this.#refuseLeakedLock(lockPath)
      return null
    }
  }

  async #refuseLeakedLock(lockPath: string): Promise<void> {
    const held = await fileAge(lockPath, this.#now())
    if (held !== null && held >= this.#staleLockMilliseconds) {
      throw new LeakedLockError(lockPath, held)
    }
  }

  async #loadPacks(): Promise<readonly PackIndex[]> {
    const directory = join(this.gitdir, 'objects', 'pack')
    const names = (await readdir(directory)).filter((name) => name.endsWith('.idx')).toSorted()
    const signature = await packSignature(directory, names)
    const cached = this.#packs
    if (cached !== null && cached.signature === signature) return cached.packs
    // `git gc` rewrites the directory wholesale, so anything cached from before
    // it ran describes packs that may no longer exist.
    await this.#closePacks()
    const packs = await Promise.all(names.map((name) => PackIndex.open(join(directory, name))))
    this.#packs = { signature, packs }
    return packs
  }

  /**
   * The reflog git writes for the same move, appended under the ref lock, and
   * mirrored to `logs/HEAD` when HEAD is the symbolic ref that points at this
   * one — which is what makes `git reflog` show the workspace's history.
   */
  async #appendReflog(name: string, from: string | null, to: string): Promise<void> {
    const seconds = Math.floor(this.#now().getTime() / 1000)
    const who = `${PRODUCT_NAME} <${PRODUCT_EMAIL}>`
    const entry = `${from ?? ZERO_OID} ${to} ${who} ${seconds} ${UTC}\tpublish\n`
    await this.#appendLog(name, entry)
    if ((await this.#readRefFile('HEAD')) === `ref: ${name}`) await this.#appendLog('HEAD', entry)
  }

  async #appendLog(name: string, entry: string): Promise<void> {
    const path = join(this.gitdir, 'logs', name)
    await this.#prepare(dirname(path))
    await appendFile(path, entry)
  }
}

function verified(oid: string, bytes: Uint8Array): Uint8Array {
  const actual = hashSerialised(bytes)
  if (actual !== oid) {
    throw new GitObjectError(`Object ${oid} is stored as ${actual}: the repository is corrupt`)
  }
  return bytes
}

async function writeIfAbsent(path: string, contents: string): Promise<void> {
  if (!existsSync(path)) await writeFile(path, contents)
}

async function packSignature(directory: string, names: readonly string[]): Promise<string> {
  const stamps = await Promise.all(
    names.map(async (name) => `${name}:${(await stat(join(directory, name))).mtimeMs}`),
  )
  return stamps.join('\n')
}

/** Run `task` over every item, `limit` of them in flight at a time. */
async function inParallel<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.values()
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const item of queue) await task(item)
  })
  await Promise.all(workers)
}

/** One bare repository per workspace, named by workspace id, under one root. */
export class FilesystemObjectStoreProvider implements ObjectStoreProvider {
  readonly #root: string
  readonly #options: FilesystemObjectStoreOptions
  readonly #stores = new Map<string, Promise<FilesystemObjectStore>>()

  constructor(root: string, options: FilesystemObjectStoreOptions) {
    this.#root = root
    this.#options = options
  }

  forWorkspace(workspaceId: WorkspaceId): Promise<FilesystemObjectStore> {
    const existing = this.#stores.get(workspaceId)
    if (existing !== undefined) return existing
    const created = FilesystemObjectStore.create(
      join(this.#root, `${workspaceId}.git`),
      this.#options,
    )
    this.#stores.set(workspaceId, created)
    return created
  }

  /** Release every repository's packfile handles. */
  async close(): Promise<void> {
    const stores = await Promise.all(this.#stores.values())
    this.#stores.clear()
    await Promise.all(stores.map((store) => store.close()))
  }
}
