import type { SourceChange, SourceFile, SourceRevision } from '@quill/application'

/**
 * What every `git`-backed source reads the same way: object ids, tree
 * entries, paths a tree could hold, commit records, and the changes between
 * two listings. Shared by the remote source (ADR-061) and the local ones
 * (ADR-062), so a file is the same file whichever of them read it.
 */

/** A full SHA-1 or SHA-256 object id. Anything else could be read as an option or a revision expression. */
export const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u

/** The tree modes a source reads; anything else (a submodule, say) is not a file of the source. */
export const FILE_KINDS: ReadonlyMap<string, SourceFile['kind']> = new Map([
  ['100644', 'file'],
  ['100755', 'file'],
  ['120000', 'symbolic-link'],
])

/** Characters that keep a command line short on every platform (Windows allows 32,767). */
const PATH_BATCH_CHARACTERS = 8000

/** A path a tree entry could have: plain segments, nothing empty, `.` or `..`, no control character. */
export function isTreePath(path: string): boolean {
  return path
    .split('/')
    .every(
      (segment) =>
        segment !== '' && segment !== '.' && segment !== '..' && !/\p{Cc}/u.test(segment),
    )
}

/** Paths in batches whose command lines stay under the limit. */
export function* pathBatches(paths: readonly string[]): Generator<readonly string[]> {
  let batch: string[] = []
  let length = 0
  for (const path of paths) {
    if (batch.length > 0 && length + path.length > PATH_BATCH_CHARACTERS) {
      yield batch
      batch = []
      length = 0
    }
    batch.push(path)
    length += path.length + 1
  }
  yield batch
}

/** `<mode> <type> <id>\t<path>`; null for anything but a file or a symbolic link (a submodule, say). */
export function treeEntry(field: string): SourceFile | null {
  const tab = field.indexOf('\t')
  const [mode = '', , fileId = ''] = field.slice(0, tab).split(' ')
  const kind = FILE_KINDS.get(mode)
  return kind === undefined ? null : { path: field.slice(tab + 1), fileId, kind }
}

/** Whether a path is one of these prefixes or under one. */
export function withinPrefixes(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/** Each path named, and every directory above it: what a listing says is there. */
export function namesWithParents(paths: Iterable<string>): Set<string> {
  const named = new Set<string>()
  for (const path of paths) {
    const segments = path.split('/')
    for (let length = 1; length <= segments.length; length += 1) {
      named.add(segments.slice(0, length).join('/'))
    }
  }
  return named
}

/**
 * How one listing became another, by path. Without the contents of what
 * moved, a move is a removal and an addition: a local source compares
 * listings, and only the remote one has `git`'s rename detection.
 */
export function* listingChanges(
  before: ReadonlyMap<string, SourceFile>,
  after: ReadonlyMap<string, SourceFile>,
): Generator<SourceChange> {
  for (const [path, file] of after) {
    const was = before.get(path)
    if (was === undefined) yield { kind: 'added', file }
    else if (was.fileId !== file.fileId || was.kind !== file.kind) yield { kind: 'modified', file }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) yield { kind: 'removed', path }
  }
}

/**
 * A commit object's author, times and subject, as `git cat-file` gives it:
 * headers, a blank line, then the message, whose first paragraph on one line
 * is the subject (as `%s` formats it).
 */
export function commitRecord(id: string, bytes: Uint8Array): SourceRevision {
  const text = new TextDecoder().decode(bytes)
  const blank = text.indexOf('\n\n')
  const headers = (blank === -1 ? text : text.slice(0, blank)).split('\n')
  const message = blank === -1 ? '' : text.slice(blank + 2)
  const person = (name: string) => {
    const line = headers.find((header) => header.startsWith(`${name} `)) ?? ''
    const match = /^\S+ (.*) <([^>]*)> (\d+) [+-]\d{4}$/u.exec(line)
    return {
      name: match?.[1] ?? '',
      email: match?.[2] ?? '',
      at: new Date(Number(match?.[3] ?? 0) * 1000),
    }
  }
  const author = person('author')
  const committer = person('committer')
  const paragraph = message.replace(/\n[ \t]*\n[\s\S]*$/u, '')
  return {
    id,
    author: { name: author.name, email: author.email },
    authoredAt: author.at,
    committedAt: committer.at,
    subject: paragraph.replaceAll(/\s*\n\s*/gu, ' ').trim(),
  }
}
