import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { ExternalSourceError } from '@quill/application'
import type {
  ExternalSource,
  OutboundHostPolicy,
  OutboundHostVerdict,
  SourceChange,
  SourceFile,
  SourceFileContent,
  SourceFileId,
  SourceRevision,
  SourceRevisionId,
} from '@quill/application'

import { GitCli } from './git-cli.ts'
import type { Deadline, GitCommand, SourceCredential } from './git-cli.ts'
import { batchObjects, nulFields } from './git-output.ts'
import { FILE_KINDS, isTreePath, OBJECT_ID, pathBatches, treeEntry } from './git-tree.ts'
import { supportedGitVersion } from './git-version.ts'
import { sourcePrefixes, sparsePatterns } from './source-paths.ts'

/**
 * What `git --version` said, by executable, asked once per process: every
 * source opened checks it, and a sync opens one each time, so asking anew
 * would be a process per sync for an answer that changes only when the
 * server's `git` is replaced, which restarts the server anyway.
 */
const versions = new Map<string, Promise<string>>()

function versionOf(git: GitCli, executable: string, cwd: string): Promise<string> {
  let asked = versions.get(executable)
  if (asked === undefined) {
    asked = git.run({ subcommand: '--version', cwd }).then(({ stdout }) => stdout.toString('utf8'))
    versions.set(executable, asked)
    // A failure is not remembered: the next source asks again.
    asked.catch(() => versions.delete(executable))
  }
  return asked
}

/**
 * The `ExternalSource` port over the `git` CLI: a partial clone limited to
 * the source's paths (ADR-061, "Fetching").
 *
 * 1. **Clone once**, with `--filter=blob:none --no-checkout --sparse`:
 *    commits and trees arrive, no file contents.
 * 2. **Narrow** with sparse-checkout patterns built from the source's
 *    paths (see `sparsePatterns` for why they are not cone patterns).
 * 3. **Backfill**: `git backfill --sparse` fetches, in batches, the contents
 *    of every file under those paths in every revision of the branch.
 * 4. **Nothing else, ever**: every other command runs with
 *    `GIT_NO_LAZY_FETCH=1`, so one that would need contents from outside the
 *    paths fails rather than fetching them.
 *
 * Contents are read by object id from the object store and never from a
 * working tree; there is none. The cache directory is disposable: deleting it
 * costs one clone. One fetch per cache directory at a time is the caller's to
 * ensure (the sync job is single-flight per source).
 */

export interface GitCliExternalSourceOptions {
  /** The repository, as an `https` URL with no credentials in it. */
  readonly remote: string
  readonly branch: string
  /** Paths the source reads: directories, files, or globs (widened to their directory unless `strictPrefixes`). */
  readonly paths: readonly string[]
  /** Refuse globs, so the instance holds exactly the paths named. */
  readonly strictPrefixes?: boolean
  /** A directory this source owns. Its contents are disposable. */
  readonly cacheDirectory: string
  /** ADR-011's outbound policy, asked before every request to the remote. */
  readonly outboundPolicy: OutboundHostPolicy
  /**
   * Asked before every request to the remote, so a short-lived token (a
   * GitHub App installation's) can be minted for each one. The credential is
   * handed to `git` in its environment and never written to disk.
   */
  readonly credential?: () => Promise<SourceCredential | null>
  readonly executable?: string
  /** For commands that stay on the instance. */
  readonly localTimeoutMs?: number
  /** For a clone, a fetch, or a backfill, which move the source's history. */
  readonly networkTimeoutMs?: number
  /**
   * For a whole fetch: clone or fetch, then backfill, together. A slow remote
   * cannot hold the sync job's lock past it. Each command stops at its own
   * timeout or at this deadline, whichever comes first.
   */
  readonly fetchDeadlineMs?: number
  /** The most a listing may write. */
  readonly maxOutputBytes?: number
  /** Files larger than this are reported as `too-large`, not read. */
  readonly maxFileBytes?: number
  /** An egress proxy enforcing the outbound policy on every connection, DNS rebinding included. */
  readonly egressProxy?: string
  /**
   * Accept `file://` remotes. Tests only: a file remote is a path on the
   * instance's own disk, outside every outbound rule.
   */
  readonly allowFileRemotesForTesting?: boolean
}

const DEFAULT_LOCAL_TIMEOUT_MS = 60_000
const DEFAULT_NETWORK_TIMEOUT_MS = 10 * 60_000
const DEFAULT_FETCH_DEADLINE_MS = 15 * 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024

/** `git check-ref-format --branch`'s rules, closely enough to refuse anything that could be read as an option. */
const BRANCH_NAME = /^(?![-/.])(?!.*(?:\.\.|\/\/|@\{|\.lock$|\/$|\.$))[^\p{Cc} ~^:?*[\\]+$/u
/** id, author name, author address, author time, committer time, subject. */
const LOG_FORMAT = '--format=%H%x00%an%x00%ae%x00%at%x00%ct%x00%s'
const LOG_FIELDS = 6
const NO_HOST_TO_CHECK: OutboundHostVerdict = { allowed: true }

interface Network {
  readonly credential: SourceCredential | null
}

interface Settings {
  readonly git: GitCli
  readonly remote: URL
  readonly branch: string
  readonly strictPrefixes: boolean
  readonly cacheDirectory: string
  readonly outboundPolicy: OutboundHostPolicy
  readonly credential: () => Promise<SourceCredential | null>
  readonly maxFileBytes: number
  readonly fetchDeadlineMs: number
}

export class GitCliExternalSource implements ExternalSource {
  readonly #settings: Settings
  /** The literal prefixes every command is limited to; `narrow` moves them. */
  #prefixes: readonly string[]
  readonly #repository: string
  readonly #home: string
  readonly #trackingRef: string
  /**
   * Commit ids already found in the clone. An object id names one commit for
   * ever and the clone only gains objects, so each is asked about once rather
   * than on every read of it; a new clone starts the set again.
   */
  readonly #present = new Set<string>()

  /**
   * Checks the options and the installed `git`, and refuses clearly when
   * either cannot work: `git` older than 2.49 has no `git backfill`.
   */
  static async open(options: GitCliExternalSourceOptions): Promise<GitCliExternalSource> {
    const remote = allowedRemote(options.remote, options.allowFileRemotesForTesting === true)
    if (!BRANCH_NAME.test(options.branch)) {
      throw new ExternalSourceError(
        'branch-not-found',
        `"${options.branch}" is not a valid branch name.`,
      )
    }
    const prefixes = sourcePrefixes(options.paths, { strict: options.strictPrefixes === true })
    if (!prefixes.ok) throw new ExternalSourceError('invalid-path', prefixes.error)

    const home = join(options.cacheDirectory, 'home')
    await mkdir(home, { recursive: true })
    const git = new GitCli({
      executable: options.executable ?? 'git',
      home,
      ceiling: options.cacheDirectory,
      localTimeoutMs: options.localTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS,
      networkTimeoutMs: options.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      allowFileProtocol: remote.protocol === 'file:',
      ...(options.egressProxy === undefined ? {} : { egressProxy: options.egressProxy }),
    })
    supportedGitVersion(await versionOf(git, options.executable ?? 'git', home))

    return new GitCliExternalSource(prefixes.value, {
      git,
      remote,
      branch: options.branch,
      strictPrefixes: options.strictPrefixes === true,
      cacheDirectory: options.cacheDirectory,
      outboundPolicy: options.outboundPolicy,
      credential: options.credential ?? (() => Promise.resolve(null)),
      maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      fetchDeadlineMs: options.fetchDeadlineMs ?? DEFAULT_FETCH_DEADLINE_MS,
    })
  }

  private constructor(prefixes: readonly string[], settings: Settings) {
    this.#prefixes = prefixes
    this.#settings = settings
    this.#repository = join(settings.cacheDirectory, 'repository')
    this.#home = join(settings.cacheDirectory, 'home')
    this.#trackingRef = `refs/remotes/origin/${settings.branch}`
  }

  async head(): Promise<SourceRevisionId> {
    const { branch, remote } = this.#settings
    const ref = `refs/heads/${branch}`
    const { stdout } = await this.#settings.git.run({
      subcommand: 'ls-remote',
      args: ['--exit-code', '--', remote.href, ref],
      cwd: this.#home,
      network: await this.#network(),
      // 2: no ref matched.
      answers: [2],
    })
    const head = stdout
      .toString('utf8')
      .split('\n')
      .map((line) => line.split('\t'))
      .find(([, name]) => name === ref)?.[0]
    if (head === undefined) {
      throw new ExternalSourceError('branch-not-found', `The remote has no branch "${branch}".`)
    }
    return head
  }

  async fetch(): Promise<SourceRevisionId> {
    const deadline = this.#fetchDeadline()
    const network = await this.#network()
    if (await exists(join(this.#repository, '.git'))) {
      // The address the policy just checked is the one fetched from, and the
      // one the backfill's own fetches use, even if the source's remote moved.
      await this.#git({
        subcommand: 'config',
        args: ['remote.origin.url', this.#settings.remote.href],
        deadline,
      })
      await this.#git({
        subcommand: 'fetch',
        args: [
          '--no-tags',
          '--no-recurse-submodules',
          '--no-write-fetch-head',
          '--',
          'origin',
          `+refs/heads/${this.#settings.branch}:${this.#trackingRef}`,
        ],
        network,
        deadline,
      })
    } else {
      await this.#clone(network, deadline)
    }
    const head = await this.#commit(this.#trackingRef, deadline)
    // `git backfill` walks from HEAD, so HEAD follows the branch.
    await this.#git({ subcommand: 'update-ref', args: ['--no-deref', 'HEAD', head], deadline })
    await this.#backfill(network, deadline)
    return head
  }

  async narrow(paths: readonly string[]): Promise<void> {
    const prefixes = sourcePrefixes(paths, { strict: this.#settings.strictPrefixes })
    if (!prefixes.ok) throw new ExternalSourceError('invalid-path', prefixes.error)
    const unchanged =
      prefixes.value.length === this.#prefixes.length &&
      prefixes.value.every((prefix, index) => prefix === this.#prefixes[index])
    this.#prefixes = prefixes.value
    // Before the first fetch there is nothing to narrow: that fetch takes these.
    if (unchanged || !(await exists(join(this.#repository, '.git')))) return
    await this.#backfill(await this.#network(), this.#fetchDeadline())
  }

  /**
   * Sets the sparse patterns to the source's paths, then fetches the
   * contents under them that the clone lacks, for every revision. Set on
   * every fetch and every narrowing: a source's paths can change, and the
   * backfill then fetches the history of any path just added.
   */
  async #backfill(network: Network, deadline: Deadline): Promise<void> {
    await this.#git({
      subcommand: 'sparse-checkout',
      args: ['set', '--no-cone', '--stdin'],
      stdin: `${sparsePatterns(this.#prefixes).join('\n')}\n`,
      deadline,
    })
    await this.#git({ subcommand: 'backfill', args: ['--sparse'], network, deadline })
  }

  #fetchDeadline(): Deadline {
    const { fetchDeadlineMs } = this.#settings
    return {
      signal: AbortSignal.timeout(fetchDeadlineMs),
      description: `the fetch did not finish within its deadline of ${fetchDeadlineMs} ms`,
    }
  }

  async *files(revision: SourceRevisionId): AsyncGenerator<SourceFile> {
    const commit = await this.#revision(revision)
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
    const within = this.#prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    if (!within) return null
    const commit = await this.#revision(revision)
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

  /**
   * Which of these paths name a file or a directory anywhere in the tree of
   * a fetched revision, inside the source's paths or not. Trees arrive with
   * every fetch, so this reads names only and needs no blob. Paths are
   * literal (`GIT_LITERAL_PATHSPECS`), asked in batches that keep each
   * command line short, and a path no tree entry could have is simply not
   * there.
   */
  async present(
    revision: SourceRevisionId,
    paths: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const asked = [...new Set(paths)].filter(isTreePath)
    if (asked.length === 0) return new Set()
    const commit = await this.#revision(revision)
    // A directory asked about is listed by what is in it, so each entry
    // listed names its own path and every directory above it.
    const named = new Set<string>()
    for (const batch of pathBatches(asked)) {
      const fields = this.#fields({
        subcommand: 'ls-tree',
        args: ['-z', '--full-tree', '--name-only', commit, '--', ...batch],
      })
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- one command at a time on the source's cache directory
      for await (const field of fields) {
        const segments = field.split('/')
        for (let length = 1; length <= segments.length; length += 1) {
          named.add(segments.slice(0, length).join('/'))
        }
      }
    }
    return new Set(asked.filter((path) => named.has(path)))
  }

  async *readFiles(fileIds: Iterable<SourceFileId>): AsyncGenerator<SourceFileContent> {
    const ids = [...fileIds]
    const malformed = ids.find((id) => !OBJECT_ID.test(id))
    if (malformed !== undefined) {
      throw new ExternalSourceError('file-missing', `"${malformed}" is not a file id.`)
    }
    if (ids.length === 0) return
    const objects = batchObjects(
      this.#settings.git.stream({
        subcommand: 'cat-file',
        args: ['--batch'],
        cwd: this.#repository,
        stdin: `${ids.join('\n')}\n`,
        // Each file is capped as it is read; the total is bounded by the ids asked for.
        maxOutputBytes: Number.POSITIVE_INFINITY,
      }),
      this.#settings.maxFileBytes,
    )
    for await (const object of objects) {
      if (object.kind === 'missing' || object.type !== 'blob') {
        throw new ExternalSourceError(
          'file-missing',
          `The source holds no file ${object.id}: it is outside the source's paths or was never fetched.`,
        )
      }
      yield object.kind === 'object'
        ? { kind: 'content', fileId: object.id, bytes: object.bytes }
        : { kind: 'too-large', fileId: object.id, size: object.size }
    }
  }

  async *history(
    since: SourceRevisionId | null,
    until: SourceRevisionId,
  ): AsyncGenerator<SourceRevision> {
    const head = await this.#revision(until)
    const base = since === null ? null : await this.#revision(since)
    const continues = base === null ? true : await this.#isAncestor(base, head)
    if (!continues) {
      throw new ExternalSourceError(
        'history-rewritten',
        `${String(base)} is not an ancestor of ${head}: the branch's history was rewritten.`,
      )
    }
    const fields = this.#fields({
      subcommand: 'log',
      args: [
        '--first-parent',
        '--reverse',
        '-z',
        '--no-color',
        LOG_FORMAT,
        head,
        ...(base === null ? [] : [`^${base}`]),
        '--',
        ...this.#prefixes,
      ],
    })
    let record: string[] = []
    for await (const field of fields) {
      record.push(field)
      if (record.length === LOG_FIELDS) {
        yield sourceRevision(record)
        record = []
      }
    }
  }

  async *changes(
    from: SourceRevisionId | null,
    to: SourceRevisionId,
  ): AsyncGenerator<SourceChange> {
    if (from === null) {
      for await (const file of this.files(to)) yield { kind: 'added', file }
      return
    }
    const before = await this.#revision(from)
    const after = await this.#revision(to)
    const fields = this.#fields({
      subcommand: 'diff-tree',
      args: ['-r', '-z', '--raw', '--find-renames', before, after, '--', ...this.#prefixes],
    })
    let raw: RawChange | null = null
    let renamedFrom: string | null = null
    for await (const field of fields) {
      if (raw === null) {
        raw = rawChange(field)
        continue
      }
      if (raw.renamed && renamedFrom === null) {
        renamedFrom = field
        continue
      }
      const change = sourceChange(raw, renamedFrom, field)
      raw = null
      renamedFrom = null
      if (change !== null) yield change
    }
  }

  /** The policy's verdict on the remote, then the credential for one request. */
  async #network(): Promise<Network> {
    const { remote, outboundPolicy, credential } = this.#settings
    // A file remote, allowed only in tests, names no host to check.
    const verdict =
      remote.protocol === 'https:' ? await outboundPolicy.check(remote) : NO_HOST_TO_CHECK
    if (!verdict.allowed) {
      throw new ExternalSourceError(
        'blocked-by-outbound-policy',
        `Requests to ${remote.hostname} are refused: ${verdict.reason}`,
      )
    }
    return { credential: await credential() }
  }

  /**
   * Clones beside the final directory and moves it into place, so an
   * interrupted clone is never mistaken for a finished one.
   */
  async #clone(network: Network, deadline: Deadline): Promise<void> {
    this.#present.clear()
    const staging = `${this.#repository}.partial`
    await rm(staging, { recursive: true, force: true })
    try {
      await this.#settings.git.run({
        subcommand: 'clone',
        args: [
          '--filter=blob:none',
          '--no-checkout',
          '--sparse',
          '--single-branch',
          `--branch=${this.#settings.branch}`,
          '--no-tags',
          '--no-recurse-submodules',
          // No templates, so no sample hooks or excludes are copied in.
          '--template=',
          '--',
          this.#settings.remote.href,
          staging,
        ],
        cwd: this.#home,
        network,
        deadline,
      })
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
    await rename(staging, this.#repository)
  }

  async #revision(revision: SourceRevisionId): Promise<string> {
    if (!OBJECT_ID.test(revision)) {
      throw new ExternalSourceError('unknown-revision', `"${revision}" is not a source revision.`)
    }
    if (this.#present.has(revision)) return revision
    const commit = await this.#commit(revision)
    this.#present.add(commit)
    return commit
  }

  async #isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const { code } = await this.#git({
      subcommand: 'merge-base',
      args: ['--is-ancestor', ancestor, descendant],
      // 1: not an ancestor.
      answers: [1],
    })
    return code === 0
  }

  async #commit(name: string, deadline?: Deadline): Promise<string> {
    const { code, stdout } = await this.#git({
      subcommand: 'rev-parse',
      args: ['--verify', '--quiet', '--end-of-options', `${name}^{commit}`],
      answers: [1],
      ...(deadline === undefined ? {} : { deadline }),
    })
    if (code === 1) {
      throw new ExternalSourceError('unknown-revision', `The source has not fetched ${name}.`)
    }
    return stdout.toString('utf8').trim()
  }

  #git(command: Omit<GitCommand, 'cwd'>): ReturnType<GitCli['run']> {
    return this.#settings.git.run({ ...command, cwd: this.#repository })
  }

  #fields(command: Omit<GitCommand, 'cwd'>): AsyncGenerator<string> {
    return nulFields(this.#settings.git.stream({ ...command, cwd: this.#repository }))
  }
}

function allowedRemote(remote: string, allowFile: boolean): URL {
  // The remote is never repeated in a refusal: a malformed one may carry a token.
  const url = URL.parse(remote)
  if (url === null) throw new ExternalSourceError('remote-not-allowed', 'The remote is not a URL.')
  if (url.username !== '' || url.password !== '') {
    throw new ExternalSourceError(
      'remote-not-allowed',
      'The remote carries credentials in its URL; supply them as the source credential instead.',
    )
  }
  if (url.protocol === 'https:' || (allowFile && url.protocol === 'file:')) return url
  throw new ExternalSourceError(
    'remote-not-allowed',
    `A source is read over https only, not ${url.protocol.replace(/:$/u, '')}.`,
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function sourceRevision([
  id = '',
  name = '',
  email = '',
  authoredAt = '',
  committedAt = '',
  subject = '',
]: readonly string[]): SourceRevision {
  return {
    id,
    author: { name, email },
    authoredAt: new Date(Number(authoredAt) * 1000),
    committedAt: new Date(Number(committedAt) * 1000),
    subject,
  }
}

interface RawChange {
  readonly before: SourceFile['kind'] | undefined
  readonly after: SourceFile['kind'] | undefined
  readonly fileId: string
  readonly renamed: boolean
}

/** `:<mode before> <mode after> <id before> <id after> <status>[<score>]`. */
function rawChange(field: string): RawChange {
  const [before = '', after = '', , fileId = '', status = ''] = field.slice(1).split(' ')
  return {
    before: FILE_KINDS.get(before),
    after: FILE_KINDS.get(after),
    fileId,
    renamed: status.startsWith('R'),
  }
}

function sourceChange(
  raw: RawChange,
  renamedFrom: string | null,
  path: string,
): SourceChange | null {
  if (raw.after === undefined) return raw.before === undefined ? null : { kind: 'removed', path }
  const file = { path, fileId: raw.fileId, kind: raw.after }
  if (renamedFrom !== null) return { kind: 'renamed', fromPath: renamedFrom, file }
  return raw.before === undefined ? { kind: 'added', file } : { kind: 'modified', file }
}
