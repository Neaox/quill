import { sourcePatternMatcher, sourcePatternPrefix } from '@quill/domain'

import type { ContentAuthor } from '../ports/content-store.ts'
import { ExternalSourceError } from '../ports/external-source.ts'
import type {
  ExternalSource,
  SourceChange,
  SourceFile,
  SourceFileContent,
  SourceRevision,
} from '../ports/external-source.ts'

/**
 * A fake external source for the sync job's tests and the preview's: a
 * first-parent chain of snapshots, each file's id its contents, narrowed as a
 * real source is.
 */

const ADA: ContentAuthor = { name: 'Ada', email: 'ada@example.com' }

// ---------------------------------------------------------------------------
// A fake external source: a first-parent chain of snapshots
// ---------------------------------------------------------------------------

export type FileSpec =
  | string
  | { readonly kind: 'symbolic-link'; readonly target: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }

export interface Commit {
  readonly id: string
  readonly files: Readonly<Record<string, FileSpec>>
  /** Paths the source's rename detection pairs, old to new. */
  readonly renames?: Readonly<Record<string, string>>
  readonly subject?: string
  readonly committedAt?: Date
}

const encoder = new TextEncoder()

export class FakeSource implements ExternalSource {
  chain: Commit[] = []
  fetches = 0
  fetchFailure: Error | null = null
  historyFailure: Error | null = null
  /** File ids `readFiles` pretends not to hold. */
  readonly missing = new Set<string>()

  constructor(commits: readonly Commit[] = []) {
    this.chain = [...commits]
  }

  push(commit: Commit): void {
    this.chain.push(commit)
  }

  async head(): Promise<string> {
    return this.chain.at(-1)?.id ?? 'empty'
  }

  async fetch(): Promise<string> {
    this.fetches += 1
    if (this.fetchFailure !== null) throw this.fetchFailure
    return await this.head()
  }

  /** What the source was narrowed to, each time. */
  readonly narrowed: (readonly string[])[] = []

  async narrow(paths: readonly string[]): Promise<void> {
    this.narrowed.push(paths)
  }

  /** Whether a path is under what the source was last narrowed to; everything before that. */
  #within(path: string): boolean {
    const paths = this.narrowed.at(-1)
    if (paths === undefined) return true
    return paths.some((pattern) => sourcePatternMatcher(sourcePatternPrefix(pattern))(path))
  }

  async *files(revision: string): AsyncIterable<SourceFile> {
    for (const [path, spec] of Object.entries(this.#commit(revision).files)) {
      if (this.#within(path)) yield toFile(path, spec)
    }
  }

  async file(revision: string, path: string): Promise<SourceFile | null> {
    // A source none of whose revisions exist yet has no files at its head.
    if (this.chain.length === 0) return null
    const spec = this.#commit(revision).files[path]
    return spec === undefined ? null : toFile(path, spec)
  }

  async *readFiles(fileIds: Iterable<string>): AsyncIterable<SourceFileContent> {
    for (const fileId of fileIds) {
      if (this.missing.has(fileId)) continue
      const spec: unknown = JSON.parse(fileId.slice(fileId.indexOf('#') + 1))
      if (typeof spec === 'string') yield { kind: 'content', fileId, bytes: encoder.encode(spec) }
      else if (isBytes(spec)) yield { kind: 'content', fileId, bytes: new Uint8Array(spec.bytes) }
      else if (isTooLarge(spec)) yield { kind: 'too-large', fileId, size: 1 << 30 }
      else throw new Error(`readFiles: ${fileId} is not a file`)
    }
  }

  async *history(since: string | null, until: string): AsyncIterable<SourceRevision> {
    if (this.historyFailure !== null) throw this.historyFailure
    const start = since === null ? 0 : this.chain.findIndex((commit) => commit.id === since) + 1
    if (start === 0 && since !== null) {
      throw new ExternalSourceError('history-rewritten', `${since} is not an ancestor`)
    }
    const end = this.chain.findIndex((commit) => commit.id === until)
    for (let index = start; index <= end; index++) {
      const commit = this.chain[index] as Commit
      const before = index === 0 ? {} : (this.chain[index - 1] as Commit).files
      if (JSON.stringify(before) !== JSON.stringify(commit.files)) yield toRevision(commit)
    }
  }

  /** The paths `present` was asked about, each time. */
  readonly asked: (readonly string[])[] = []

  /** Anywhere in the repository, as names are: a file, or a directory some file is in. */
  async present(revision: string, paths: readonly string[]): Promise<ReadonlySet<string>> {
    this.asked.push(paths)
    const files = Object.keys(this.#commit(revision).files)
    return new Set(
      paths.filter((path) => files.some((file) => file === path || file.startsWith(`${path}/`))),
    )
  }

  async *changes(from: string | null, to: string): AsyncIterable<SourceChange> {
    // As a diff limited to the source's paths sees it: a rename across their
    // edge is a removal or an addition.
    for await (const change of this.#allChanges(from, to)) {
      if (change.kind === 'removed') {
        if (this.#within(change.path)) yield change
      } else if (change.kind !== 'renamed' || this.#within(change.fromPath)) {
        if (this.#within(change.file.path)) yield change
        else if (change.kind === 'renamed') yield { kind: 'removed', path: change.fromPath }
      } else if (this.#within(change.file.path)) {
        yield { kind: 'added', file: change.file }
      }
    }
  }

  async *#allChanges(from: string | null, to: string): AsyncIterable<SourceChange> {
    const before = from === null ? {} : this.#commit(from).files
    const after = this.#commit(to)
    const renames = after.renames ?? {}
    const renamedTo = new Set(Object.values(renames))
    for (const [fromPath, toPath] of Object.entries(renames)) {
      yield { kind: 'renamed', fromPath, file: toFile(toPath, after.files[toPath] as FileSpec) }
    }
    for (const [path, spec] of Object.entries(after.files)) {
      if (renamedTo.has(path)) continue
      if (!(path in before)) yield { kind: 'added', file: toFile(path, spec) }
      else if (JSON.stringify(before[path]) !== JSON.stringify(spec)) {
        yield { kind: 'modified', file: toFile(path, spec) }
      }
    }
    for (const path of Object.keys(before)) {
      if (!(path in after.files) && !(path in renames)) yield { kind: 'removed', path }
    }
  }

  #commit(id: string): Commit {
    const commit = this.chain.find((candidate) => candidate.id === id)
    if (commit === undefined) throw new ExternalSourceError('unknown-revision', id)
    return commit
  }
}

function isBytes(spec: unknown): spec is { kind: 'bytes'; bytes: number[] } {
  return typeof spec === 'object' && spec !== null && (spec as { kind?: unknown }).kind === 'bytes'
}

function isTooLarge(spec: unknown): boolean {
  return (
    typeof spec === 'object' && spec !== null && (spec as { kind?: unknown }).kind === 'too-large'
  )
}

/** Content-addressed, so equal contents share an id, as a real source's do. */
export function toFile(path: string, spec: FileSpec): SourceFile {
  const serialisable =
    typeof spec === 'object' && spec.kind === 'bytes'
      ? { kind: 'bytes', bytes: [...spec.bytes] }
      : spec
  const fileId = `${path}#${JSON.stringify(serialisable)}`
  const kind = typeof spec === 'object' && spec.kind === 'symbolic-link' ? 'symbolic-link' : 'file'
  return { path, fileId, kind }
}

let tick = 0
function toRevision(commit: Commit): SourceRevision {
  tick += 1
  const committedAt = commit.committedAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, tick))
  return {
    id: commit.id,
    author: ADA,
    authoredAt: committedAt,
    committedAt,
    subject: commit.subject ?? `Change ${commit.id}`,
  }
}
