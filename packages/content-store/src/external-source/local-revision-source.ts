import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

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
import type { GitCommand } from './git-cli.ts'
import { batchObjects, nulFields } from './git-output.ts'
import {
  commitRecord,
  isTreePath,
  listingChanges,
  namesWithParents,
  OBJECT_ID,
  pathBatches,
  treeEntry,
  withinPrefixes,
} from './git-tree.ts'
import { sourcePrefixes } from './source-paths.ts'

/**
 * The `ExternalSource` port over one revision of a repository on this disk
 * (ADR-062): what `quill check --rev <rev>` reads.
 *
 * It is hardened as the remote source is (ADR-061), through the same
 * `GitCli`: arguments as an array with no shell, no system or global
 * configuration, no hooks, `protocol.allow=never` with no protocol allowed
 * back, and `GIT_NO_LAZY_FETCH=1`, so a partial clone never fetches what it
 * lacks. It runs three commands and no others: `rev-parse` to name the
 * revision, `ls-tree` to list it and `cat-file --batch` to read it.
 *
 * It reads one revision, so that revision is its whole history, and the
 * changes from nothing to it are every file. A move between two listings is
 * a removal and an addition: without `git diff` there is no rename detection.
 */

export interface LocalRevisionSourceOptions {
  /** The repository's working tree, or its `.git` directory. */
  readonly repository: string
  /** A revision expression: a branch, a tag, `HEAD`, or a commit id. */
  readonly revision: string
  /** Paths the source reads: directories, files, or globs. */
  readonly paths: readonly string[]
  readonly executable?: string
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  /** Files larger than this are reported as `too-large`, not read. */
  readonly maxFileBytes?: number
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024

/** What may be asked of `rev-parse`: no option, no whitespace, nothing a shell or `git` would read twice. */
const REVISION = /^(?!-)[^\p{Cc}\s]+$/u

export class LocalRevisionSource implements ExternalSource {
  readonly #git: GitCli
  readonly #repository: string
  readonly #home: string
  readonly #commit: string
  readonly #maxFileBytes: number
  #prefixes: readonly string[]

  /** Names the revision, and refuses clearly when it is not a commit of the repository. */
  static async open(options: LocalRevisionSourceOptions): Promise<LocalRevisionSource> {
    const prefixes = sourcePrefixes(options.paths, { strict: false })
    if (!prefixes.ok) throw new ExternalSourceError('invalid-path', prefixes.error)
    if (!REVISION.test(options.revision)) {
      throw new ExternalSourceError(
        'unknown-revision',
        `"${options.revision}" is not a revision of the repository.`,
      )
    }
    const repository = resolve(options.repository)
    // An empty home of its own, so no `.gitconfig` or `.netrc` is found.
    const home = await mkdtemp(join(tmpdir(), `${BRAND.slug}-local-revision-`))
    const git = new GitCli({
      executable: options.executable ?? 'git',
      home,
      // Discovery stops above the repository, so nothing around it is read.
      ceiling: dirname(repository),
      localTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      networkTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      allowFileProtocol: false,
    })
    try {
      const { code, stdout } = await git.run({
        subcommand: 'rev-parse',
        args: ['--verify', '--quiet', '--end-of-options', `${options.revision}^{commit}`],
        cwd: repository,
        // 1: no such commit.
        answers: [1],
      })
      if (code === 1) {
        throw new ExternalSourceError(
          'unknown-revision',
          `The repository has no commit "${options.revision}".`,
        )
      }
      return new LocalRevisionSource({
        git,
        repository,
        home,
        commit: stdout.toString('utf8').trim(),
        prefixes: prefixes.value,
        maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      })
    } catch (error) {
      await rm(home, { recursive: true, force: true })
      throw error
    }
  }

  private constructor(settings: {
    readonly git: GitCli
    readonly repository: string
    readonly home: string
    readonly commit: string
    readonly prefixes: readonly string[]
    readonly maxFileBytes: number
  }) {
    this.#git = settings.git
    this.#repository = settings.repository
    this.#home = settings.home
    this.#commit = settings.commit
    this.#prefixes = settings.prefixes
    this.#maxFileBytes = settings.maxFileBytes
  }

  /** Removes the empty home it made. The source answers nothing afterwards. */
  async close(): Promise<void> {
    await rm(this.#home, { recursive: true, force: true })
  }

  head(): Promise<SourceRevisionId> {
    return Promise.resolve(this.#commit)
  }

  /** Nothing to fetch: the revision is on this disk already. */
  fetch(): Promise<SourceRevisionId> {
    return Promise.resolve(this.#commit)
  }

  /** Reading is by object id, so narrowing only moves which paths are listed. */
  async narrow(paths: readonly string[]): Promise<void> {
    const prefixes = sourcePrefixes(paths, { strict: false })
    if (!prefixes.ok) throw new ExternalSourceError('invalid-path', prefixes.error)
    this.#prefixes = prefixes.value
  }

  async *files(revision: SourceRevisionId): AsyncGenerator<SourceFile> {
    const commit = this.#revision(revision)
    const fields = this.#fields({
      subcommand: 'ls-tree',
      args: ['-r', '-z', '--full-tree', commit, '--', ...this.#prefixes],
    })
    for await (const field of fields) {
      const file = treeEntry(field)
      if (file !== null) yield file
    }
  }

  async file(revision: SourceRevisionId, path: string): Promise<SourceFile | null> {
    if (!withinPrefixes(path, this.#prefixes)) return null
    const commit = this.#revision(revision)
    const fields = this.#fields({
      subcommand: 'ls-tree',
      args: ['-z', '--full-tree', commit, '--', path],
    })
    let found: SourceFile | null = null
    for await (const field of fields) {
      const file = treeEntry(field)
      if (file?.path === path) found = file
    }
    return found
  }

  /** Names only, from the revision's trees, anywhere in the repository; nothing is read. */
  async present(
    revision: SourceRevisionId,
    paths: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const asked = [...new Set(paths)].filter(isTreePath)
    if (asked.length === 0) return new Set()
    const commit = this.#revision(revision)
    const listed: string[] = []
    for (const batch of pathBatches(asked)) {
      const fields = this.#fields({
        subcommand: 'ls-tree',
        args: ['-z', '--full-tree', '--name-only', commit, '--', ...batch],
      })
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- one command at a time on the repository
      for await (const field of fields) listed.push(field)
    }
    const named = namesWithParents(listed)
    return new Set(asked.filter((path) => named.has(path)))
  }

  async *readFiles(fileIds: Iterable<SourceFileId>): AsyncGenerator<SourceFileContent> {
    const ids = [...fileIds]
    const malformed = ids.find((id) => !OBJECT_ID.test(id))
    if (malformed !== undefined) {
      throw new ExternalSourceError('file-missing', `"${malformed}" is not a file id.`)
    }
    if (ids.length === 0) return
    for await (const object of this.#objects(ids, this.#maxFileBytes)) {
      if (object.kind === 'missing' || object.type !== 'blob') {
        throw new ExternalSourceError('file-missing', `The repository holds no file ${object.id}.`)
      }
      yield object.kind === 'object'
        ? { kind: 'content', fileId: object.id, bytes: object.bytes }
        : { kind: 'too-large', fileId: object.id, size: object.size }
    }
  }

  /** The one revision, unless it is where the reader already is. */
  async *history(
    since: SourceRevisionId | null,
    until: SourceRevisionId,
  ): AsyncGenerator<SourceRevision> {
    const commit = this.#revision(until)
    if (since === commit) return
    if (since !== null) this.#revision(since)
    for await (const object of this.#objects([commit], Number.POSITIVE_INFINITY)) {
      /* v8 ignore next -- the commit was named by rev-parse, so it is there to read. */
      if (object.kind !== 'object') throw new ExternalSourceError('unknown-revision', commit)
      yield commitRecord(commit, object.bytes)
    }
  }

  async *changes(
    from: SourceRevisionId | null,
    to: SourceRevisionId,
  ): AsyncGenerator<SourceChange> {
    const after = await this.#listing(to)
    const before = from === null ? new Map<string, SourceFile>() : await this.#listing(from)
    yield* listingChanges(before, after)
  }

  async #listing(revision: SourceRevisionId): Promise<Map<string, SourceFile>> {
    const listing = new Map<string, SourceFile>()
    for await (const file of this.files(revision)) listing.set(file.path, file)
    return listing
  }

  /** The source answers for its one revision and no other. */
  #revision(revision: SourceRevisionId): string {
    if (revision !== this.#commit) {
      throw new ExternalSourceError(
        'unknown-revision',
        `This source reads ${this.#commit}, not "${revision}".`,
      )
    }
    return revision
  }

  #objects(ids: readonly string[], maxBytes: number) {
    return batchObjects(
      this.#git.stream({
        subcommand: 'cat-file',
        args: ['--batch'],
        cwd: this.#repository,
        stdin: `${ids.join('\n')}\n`,
        // Each object is capped as it is read; the total is bounded by the ids asked for.
        maxOutputBytes: Number.POSITIVE_INFINITY,
      }),
      maxBytes,
    )
  }

  #fields(command: Omit<GitCommand, 'cwd'>): AsyncGenerator<string> {
    return nulFields(this.#git.stream({ ...command, cwd: this.#repository }))
  }
}
