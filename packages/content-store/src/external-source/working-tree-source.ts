import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdtemp, readdir, readFile, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import { ExternalSourceError } from '@quill/application'
import { BRAND } from '@quill/brand'
import type {
  ExternalSource,
  SourceChange,
  SourceFile,
  SourceFileContent,
  SourceFileId,
  SourceRevision,
  SourceRevisionId,
} from '@quill/application'

import { GitCli } from './git-cli.ts'
import { nulFields } from './git-output.ts'
import { isTreePath, listingChanges, namesWithParents, withinPrefixes } from './git-tree.ts'
import { sourcePrefixes } from './source-paths.ts'

/**
 * The `ExternalSource` port over a working tree on this disk (ADR-062): what
 * `quill check` and `quill preview` read, the files as they are now.
 *
 * - **A file's id is its Git blob id**, computed from the bytes on disk, so an
 *   unchanged file has the same id here as at any revision that holds it.
 * - **`head()` is a digest** of the sorted `(path, file id, kind)` listing:
 *   equal trees are equal revisions. That revision is the whole history, and
 *   the changes from nothing to it are every file.
 * - **Which files there are** comes from Git when it is there: the index and
 *   the untracked files it does not ignore, so a build directory is not read.
 *   Without `git`, the directories under the source's paths are listed, with
 *   `.git` left out.
 * - **`narrow` is honoured**: files are listed, and contents read, only under
 *   the source's paths, as on the server.
 * - **`present()` reads names, never contents**, from anywhere in the tree:
 *   Git's index and the listing when `git` is there, otherwise the listings
 *   of the directories on the way to each path. Names are compared exactly,
 *   so on a disk that ignores case `./Setup.md` is not `setup.md`, as it is
 *   not on the server. It never asks the disk whether a path exists.
 * - **A symbolic link is never followed**, nor is a junction: its contents are
 *   the path it points to, as Git stores it. A file the index records as a
 *   link (checked out as a plain file where `core.symlinks` is false) is a
 *   link too, with the same contents as at the revision.
 * - **Bytes are read as they are on disk.** A checkout that converted line
 *   endings holds other bytes than the revision, and is read as it holds them.
 */

export interface WorkingTreeSourceOptions {
  /** The working tree's top directory. */
  readonly root: string
  /** Paths the source reads: directories, files, or globs. */
  readonly paths: readonly string[]
  /** `git`, to read the index; null to list directories instead. */
  readonly executable?: string | null
  readonly timeoutMs?: number
  /** Files larger than this are reported as `too-large`, not read. */
  readonly maxFileBytes?: number
  /** The clock, injected: when the working tree's one revision is said to be made. */
  readonly now: () => Date
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const SYMBOLIC_LINK_MODE = '120000'
/** A gitlink: a submodule's commit, which is not a file of the source. */
const SUBMODULE_MODE = '160000'
const WORKING_TREE = { name: 'Working tree', email: '' } as const

interface Listed extends SourceFile {
  /** Where it is on disk. */
  readonly location: string
}

/** What Git knows about the tree: each tracked path's mode, and the untracked paths it does not ignore. */
interface GitNames {
  readonly tracked: ReadonlyMap<string, string>
  readonly untracked: readonly string[]
}

/** A file's Git blob id: the SHA-1 of `blob <size>\0` and its bytes. */
export function blobId(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}

async function streamedBlobId(location: string, size: number): Promise<string> {
  const hash = createHash('sha1').update(`blob ${size}\0`)
  for await (const chunk of createReadStream(location)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * What a link points to, as Git stores it: with `/` between segments. On
 * Windows a link's target is written with the platform's separator, as Git
 * for Windows writes one it checks out, and Git turns them back when it
 * reads one; elsewhere the separator is `/` already.
 */
async function linkTarget(location: string): Promise<Buffer> {
  return Buffer.from((await readlink(location)).split(sep).join('/'))
}

export class WorkingTreeSource implements ExternalSource {
  readonly #root: string
  readonly #git: GitCli | null
  readonly #home: string | null
  readonly #maxFileBytes: number
  readonly #now: () => Date
  #prefixes: readonly string[]
  /** Each revision this source has named, with when it named it and what was there. */
  readonly #revisions = new Map<
    SourceRevisionId,
    { readonly at: Date; readonly listing: ReadonlyMap<string, Listed> }
  >()
  /** Where each file id listed so far is on disk, so its contents can be read by id. */
  readonly #locations = new Map<SourceFileId, Listed>()

  static async open(options: WorkingTreeSourceOptions): Promise<WorkingTreeSource> {
    const prefixes = sourcePrefixes(options.paths, { strict: false })
    if (!prefixes.ok) throw new ExternalSourceError('invalid-path', prefixes.error)
    const root = resolve(options.root)
    const executable = options.executable === undefined ? 'git' : options.executable
    // An empty home of its own, so no `.gitconfig` or `.netrc` is found.
    const home =
      executable === null ? null : await mkdtemp(join(tmpdir(), `${BRAND.slug}-working-tree-`))
    const git =
      executable === null || home === null
        ? null
        : new GitCli({
            executable,
            home,
            ceiling: dirname(root),
            localTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            networkTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
            allowFileProtocol: false,
          })
    return new WorkingTreeSource({
      root,
      git,
      home,
      prefixes: prefixes.value,
      maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      now: options.now,
    })
  }

  private constructor(settings: {
    readonly root: string
    readonly git: GitCli | null
    readonly home: string | null
    readonly prefixes: readonly string[]
    readonly maxFileBytes: number
    readonly now: () => Date
  }) {
    this.#root = settings.root
    this.#git = settings.git
    this.#home = settings.home
    this.#prefixes = settings.prefixes
    this.#maxFileBytes = settings.maxFileBytes
    this.#now = settings.now
  }

  /** Removes the empty home it made, if it made one. */
  async close(): Promise<void> {
    if (this.#home !== null) await rm(this.#home, { recursive: true, force: true })
  }

  /** The tree as it is now, as one revision. */
  async head(): Promise<SourceRevisionId> {
    const listing = await this.#list()
    const digest = createHash('sha1')
    for (const file of listing.values()) {
      digest.update(`${file.path}\0${file.fileId}\0${file.kind}\n`)
    }
    const revision = digest.digest('hex')
    if (!this.#revisions.has(revision)) {
      this.#revisions.set(revision, { at: this.#now(), listing })
    }
    return revision
  }

  /** Nothing to fetch: the tree is on this disk. */
  fetch(): Promise<SourceRevisionId> {
    return this.head()
  }

  async narrow(paths: readonly string[]): Promise<void> {
    const prefixes = sourcePrefixes(paths, { strict: false })
    if (!prefixes.ok) throw new ExternalSourceError('invalid-path', prefixes.error)
    this.#prefixes = prefixes.value
  }

  /** The files under the source's paths as they are now: a working tree has one revision. */
  async *files(revision: SourceRevisionId): AsyncGenerator<SourceFile> {
    this.#known(revision)
    for (const file of (await this.#list()).values()) {
      yield { path: file.path, fileId: file.fileId, kind: file.kind }
    }
  }

  async file(revision: SourceRevisionId, path: string): Promise<SourceFile | null> {
    this.#known(revision)
    if (!withinPrefixes(path, this.#prefixes)) return null
    const file = (await this.#list()).get(path)
    return file === undefined ? null : { path: file.path, fileId: file.fileId, kind: file.kind }
  }

  async present(
    revision: SourceRevisionId,
    paths: readonly string[],
  ): Promise<ReadonlySet<string>> {
    this.#known(revision)
    const asked = [...new Set(paths)].filter(isTreePath)
    if (asked.length === 0) return new Set()
    const names = await this.#gitNames()
    if (names !== null) {
      const listed = await this.#list()
      const named = namesWithParents([
        ...names.tracked.keys(),
        ...names.untracked,
        ...listed.keys(),
      ])
      return new Set(asked.filter((path) => named.has(path)))
    }
    // Directory by directory, comparing names exactly.
    const listings = new Map<string, Promise<ReadonlySet<string>>>()
    const namesIn = (directory: string) => {
      let listing = listings.get(directory)
      if (listing === undefined) {
        listing = readdir(join(this.#root, directory)).then(
          (entries) => new Set(entries.filter((entry) => directory !== '' || entry !== '.git')),
          () => new Set<string>(),
        )
        listings.set(directory, listing)
      }
      return listing
    }
    const present = new Set<string>()
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- listings are shared between paths, so each is read once
    for (const path of asked) {
      const segments = path.split('/')
      let found = true
      for (const [index, segment] of segments.entries()) {
        // oxlint-disable-next-line quill/no-independent-await-in-loop -- each segment is looked for in the directory the last one named
        found = (await namesIn(segments.slice(0, index).join('/'))).has(segment)
        if (!found) break
      }
      if (found) present.add(path)
    }
    return present
  }

  async *readFiles(fileIds: Iterable<SourceFileId>): AsyncGenerator<SourceFileContent> {
    for (const fileId of fileIds) {
      const file = this.#locations.get(fileId)
      if (file === undefined) {
        throw new ExternalSourceError(
          'file-missing',
          `No file under the source's paths is ${fileId}.`,
        )
      }
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- in the order asked for, one file at a time
      const read = await this.#contents(file)
      if (read.kind === 'too-large') {
        yield { kind: 'too-large', fileId, size: read.size }
        continue
      }
      if (blobId(read.bytes) !== fileId) {
        throw new ExternalSourceError(
          'file-missing',
          `${file.path} changed after it was listed; check again.`,
        )
      }
      yield { kind: 'content', fileId, bytes: read.bytes }
    }
  }

  async *history(
    since: SourceRevisionId | null,
    until: SourceRevisionId,
  ): AsyncGenerator<SourceRevision> {
    const { at } = this.#known(until)
    if (since === until) return
    if (since !== null) this.#known(since)
    yield {
      id: until,
      author: WORKING_TREE,
      authoredAt: at,
      committedAt: at,
      subject: 'The working tree',
    }
  }

  async *changes(
    from: SourceRevisionId | null,
    to: SourceRevisionId,
  ): AsyncGenerator<SourceChange> {
    this.#known(to)
    const after = new Map<string, SourceFile>()
    for await (const file of this.files(to)) after.set(file.path, file)
    const before = from === null ? new Map<string, Listed>() : this.#known(from).listing
    const within = new Map([...before].filter(([path]) => withinPrefixes(path, this.#prefixes)))
    yield* listingChanges(within, after)
  }

  #known(revision: SourceRevisionId) {
    const known = this.#revisions.get(revision)
    if (known === undefined) {
      throw new ExternalSourceError(
        'unknown-revision',
        `"${revision}" is not a revision of this working tree.`,
      )
    }
    return known
  }

  /** The index's modes and the untracked files Git does not ignore; null without `git` or a repository. */
  async #gitNames(): Promise<GitNames | null> {
    const git = this.#git
    if (git === null) return null
    try {
      const tracked = new Map<string, string>()
      for await (const field of nulFields(
        git.stream({ subcommand: 'ls-files', args: ['-z', '--stage'], cwd: this.#root }),
      )) {
        const tab = field.indexOf('\t')
        tracked.set(field.slice(tab + 1), field.slice(0, field.indexOf(' ')))
      }
      const untracked: string[] = []
      for await (const field of nulFields(
        git.stream({
          subcommand: 'ls-files',
          args: ['-z', '--others', '--exclude-standard'],
          cwd: this.#root,
        }),
      )) {
        untracked.push(field)
      }
      return { tracked, untracked }
    } catch {
      return null
    }
  }

  /** The files under the source's paths now, by path. */
  async #list(): Promise<ReadonlyMap<string, Listed>> {
    const names = await this.#gitNames()
    const candidates =
      names === null
        ? await this.#walk()
        : [...names.tracked.keys(), ...names.untracked].filter((path) =>
            withinPrefixes(path, this.#prefixes),
          )
    // In path order, which is the order every listing is read in.
    const listing = new Map<string, Listed>()
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one file at a time, so a large tree does not open every file at once
    for (const path of candidates.toSorted()) {
      const mode = names?.tracked.get(path)
      if (mode === SUBMODULE_MODE) continue
      const file = await this.#entry(path, mode === SYMBOLIC_LINK_MODE)
      if (file !== null) {
        listing.set(path, file)
        this.#locations.set(file.fileId, file)
      }
    }
    return listing
  }

  /** One path on disk as a file of the source, or null when it is not a file or a link there. */
  async #entry(path: string, recordedAsLink: boolean): Promise<Listed | null> {
    const location = join(this.#root, path)
    const stats = await lstat(location).catch(() => null)
    if (stats === null) return null
    const isLink = stats.isSymbolicLink()
    if (!isLink && !stats.isFile()) return null
    const kind: SourceFile['kind'] = isLink || recordedAsLink ? 'symbolic-link' : 'file'
    if (isLink) {
      const bytes = await linkTarget(location)
      return { path, location, kind, fileId: blobId(bytes) }
    }
    const fileId =
      stats.size > this.#maxFileBytes
        ? await streamedBlobId(location, stats.size)
        : blobId(await readFile(location))
    return { path, location, kind, fileId }
  }

  async #contents(
    file: Listed,
  ): Promise<
    | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
    | { readonly kind: 'too-large'; readonly size: number }
  > {
    const stats = await lstat(file.location).catch(() => null)
    if (stats === null) {
      throw new ExternalSourceError('file-missing', `${file.path} is gone; check again.`)
    }
    if (stats.isSymbolicLink()) {
      return { kind: 'bytes', bytes: await linkTarget(file.location) }
    }
    if (stats.size > this.#maxFileBytes) return { kind: 'too-large', size: stats.size }
    return { kind: 'bytes', bytes: await readFile(file.location) }
  }

  /** Without `git`: the files and links under the source's paths, links never followed, `.git` left out. */
  async #walk(): Promise<string[]> {
    const found: string[] = []
    const visit = async (path: string): Promise<void> => {
      const stats = await lstat(join(this.#root, path)).catch(() => null)
      if (stats === null) return
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        found.push(path)
        return
      }
      const entries = await readdir(join(this.#root, path))
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- a directory at a time, in name order
      for (const entry of entries.toSorted()) {
        // A nested repository's own store is never a file of the source.
        if (entry !== '.git') await visit(`${path}/${entry}`)
      }
    }
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- each of the source's paths in turn
    for (const prefix of this.#prefixes) await visit(prefix)
    return found
  }
}
