import { err, ok } from '../result.ts'
import type { Result } from '../result.ts'

/**
 * The rules a sourced workspace's settings must satisfy before they are
 * stored (ADR-061, "A source is configured on a workspace"). Each check
 * answers with the value as it will be stored, or with a sentence an
 * administrator can act on.
 *
 * The adapter that fetches checks its own inputs again; these exist so that a
 * setting it would refuse is refused when it is entered, not at the first
 * sync.
 */

/** `full` replays every revision; `head` imports only the current one. */
export const SOURCE_HISTORY_SETTINGS = ['full', 'head'] as const
export type SourceHistorySetting = (typeof SOURCE_HISTORY_SETTINGS)[number]

/** `subject` shows each revision's subject as its change note; `none` shows no message. */
export const SOURCE_COMMIT_MESSAGE_SETTINGS = ['subject', 'none'] as const
export type SourceCommitMessageSetting = (typeof SOURCE_COMMIT_MESSAGE_SETTINGS)[number]

/**
 * How a collection orders the documents that do not say where they go
 * (ADR-061, "Tree, titles and order"): by `title` (the default), by file
 * name, or by when each first appeared in the source, `newest` or `oldest`
 * first.
 */
export const SOURCE_COLLECTION_ORDERS = ['title', 'filename', 'newest', 'oldest'] as const
export type SourceCollectionOrder = (typeof SOURCE_COLLECTION_ORDERS)[number]

export const MAX_SOURCE_REMOTE_LENGTH = 2048
export const MAX_SOURCE_BRANCH_LENGTH = 255
export const MAX_SOURCE_PATH_LENGTH = 1024
export const MAX_SOURCE_USERNAME_LENGTH = 256

export interface SourceRemoteOptions {
  /** Accept `file://` remotes. Tests only: a file remote is a path on the instance's own disk. */
  readonly allowFileRemotes: boolean
}

/**
 * An `https` address with no credentials, query or fragment in it. A
 * credential in the address would be stored in plain text and shown back; it
 * belongs in the secrets store, referenced by name (ADR-034).
 */
export function checkSourceRemote(
  value: string,
  options: SourceRemoteOptions,
): Result<string, string> {
  if (value.length > MAX_SOURCE_REMOTE_LENGTH) {
    return err(`The address is longer than ${MAX_SOURCE_REMOTE_LENGTH} characters.`)
  }
  if (!URL.canParse(value)) return err(`"${value}" is not an address.`)
  const url = new URL(value)
  const file = url.protocol === 'file:' && options.allowFileRemotes
  if (url.protocol !== 'https:' && !file) return err('The address must start with https://.')
  if (url.username !== '' || url.password !== '') {
    return err(
      'The address must not carry a user name or password; reference a secret for the credential.',
    )
  }
  if (url.search !== '' || url.hash !== '') {
    return err('The address must not have a query or a fragment.')
  }
  return ok(url.href)
}

/**
 * `git check-ref-format --branch`'s rules, closely enough that nothing
 * accepted here can be read as an option or a revision expression.
 */
const BRANCH_NAME = /^(?![-/.])(?!.*(?:\.\.|\/\/|@\{|\.lock$|\/$|\.$))[^\p{Cc} ~^:?*[\\]+$/u

export function checkSourceBranch(value: string): Result<string, string> {
  if (value.length > MAX_SOURCE_BRANCH_LENGTH) {
    return err(`The branch name is longer than ${MAX_SOURCE_BRANCH_LENGTH} characters.`)
  }
  return BRANCH_NAME.test(value) ? ok(value) : err(`"${value}" is not a valid branch name.`)
}

const GLOB_CHARACTERS = /[*?[{]/u
const UNSAFE_IN_SEGMENT = /[\\\p{Cc}]/u

/** `value` without a trailing `/`, when it is plain segments separated by `/`; null otherwise. */
function plainSegments(value: string): string | null {
  const path = value.replace(/\/+$/u, '')
  const plain = path
    .split('/')
    .every(
      (segment) =>
        segment !== '' && segment !== '.' && segment !== '..' && !UNSAFE_IN_SEGMENT.test(segment),
    )
  return plain ? path : null
}

/**
 * A path in the source: a directory or a file, as plain segments separated by
 * `/`, relative to the repository's root. A trailing `/` is dropped.
 *
 * Globs are refused in a source's stored settings: they belong in the
 * manifest (`checkSourcePattern`), which the sync job narrows again when it
 * reads.
 */
export function checkSourcePath(value: string): Result<string, string> {
  if (value.length > MAX_SOURCE_PATH_LENGTH) {
    return err(`The path is longer than ${MAX_SOURCE_PATH_LENGTH} characters.`)
  }
  const path = plainSegments(value)
  if (path === null) {
    return err(`"${value}" is not a relative path of plain segments separated by "/".`)
  }
  if (GLOB_CHARACTERS.test(path)) {
    return err(`"${value}" is a glob; name a directory or a file.`)
  }
  return ok(path)
}

/** Wildcards a manifest's paths may not use: character classes and braces. */
const UNREAD_WILDCARDS = /[[\]{}]/u

/** `*` within a segment, `**` as a whole segment, `?` for one character. */
function isReadableSegment(segment: string): boolean {
  if (UNREAD_WILDCARDS.test(segment)) return false
  return segment === '**' || !segment.includes('**')
}

/**
 * A path a manifest names (ADR-061): a directory, a file, or a glob such as
 * `packages/**\/README.md`. A trailing `/` is dropped.
 *
 * A glob needs a literal directory in front of its first wildcard, because
 * the fetch is widened to that directory, and a glob with none would widen
 * to the whole repository. `**` stands alone as a segment, and character
 * classes and braces are refused, so a pattern means the same here as in
 * `sourcePatternMatcher`.
 */
export function checkSourcePattern(value: string): Result<string, string> {
  if (value.length > MAX_SOURCE_PATH_LENGTH) {
    return err(`The path is longer than ${MAX_SOURCE_PATH_LENGTH} characters.`)
  }
  const path = plainSegments(value)
  if (path === null) {
    return err(`"${value}" is not a relative path of plain segments separated by "/".`)
  }
  const segments = path.split('/')
  if (!segments.every(isReadableSegment)) {
    return err(
      `"${value}" uses a wildcard this version does not read: use "*", "**" as a whole segment, or "?".`,
    )
  }
  if (isSourceGlob(path.split('/', 1).join(''))) {
    return err(
      `"${value}" is a glob with no directory in front of it, which would read everything.`,
    )
  }
  return ok(path)
}

/** Whether a pattern from `checkSourcePattern` holds a wildcard. */
export function isSourceGlob(pattern: string): boolean {
  return GLOB_CHARACTERS.test(pattern)
}

/** The literal directories in front of a pattern's first wildcard; the whole pattern when it has none. */
export function sourcePatternPrefix(pattern: string): string {
  const segments = pattern.split('/')
  const firstGlob = segments.findIndex((segment) => GLOB_CHARACTERS.test(segment))
  return firstGlob === -1 ? pattern : segments.slice(0, firstGlob).join('/')
}

const REGEX_SPECIAL = /[.+^$()|\\{}[\]]/gu

/** A pattern from `checkSourcePattern` as an expression over a whole path. */
function patternExpression(pattern: string): RegExp {
  const segments = pattern.split('/')
  const body = segments
    .map((segment, index) => {
      const last = index === segments.length - 1
      // `a/**/b` matches `a/b` too: `**` takes the slash after it with it.
      if (segment === '**') return last ? '.*' : '(?:[^/]+/)*'
      const literal = segment
        .replaceAll(REGEX_SPECIAL, '\\$&')
        .replaceAll('*', '[^/]*')
        .replaceAll('?', '[^/]')
      return last ? literal : `${literal}/`
    })
    .join('')
  return new RegExp(`^${body}$`, 'u')
}

/**
 * A test of whether a file lies under a pattern: the pattern names the file,
 * or one of the directories it is in. `docs` covers `docs/a.md`; `docs/*`
 * covers `docs/a.md` and `docs/guides/b.md`; `packages/**\/README.md` covers
 * `packages/README.md` and `packages/ui/README.md`. Made once per pattern, so
 * a long list of files is tested against one compiled expression.
 */
export function sourcePatternMatcher(pattern: string): (path: string) => boolean {
  if (!isSourceGlob(pattern)) {
    return (path) => path === pattern || path.startsWith(`${pattern}/`)
  }
  const expression = patternExpression(pattern)
  return (path) => {
    const segments = path.split('/')
    for (let length = segments.length; length > 0; length -= 1) {
      if (expression.test(segments.slice(0, length).join('/'))) return true
    }
    return false
  }
}

/**
 * The user name half of an HTTP Basic credential: `x-access-token` for a
 * GitHub token, a deploy token's own name elsewhere. A colon would end it.
 */
export function checkSourceUsername(value: string): Result<string, string> {
  if (value.length === 0) return err('The credential needs a user name.')
  if (value.length > MAX_SOURCE_USERNAME_LENGTH) {
    return err(`The user name is longer than ${MAX_SOURCE_USERNAME_LENGTH} characters.`)
  }
  if (value.includes(':') || /\p{Cc}/u.test(value)) {
    return err('The user name must not contain a colon or a control character.')
  }
  return ok(value)
}
