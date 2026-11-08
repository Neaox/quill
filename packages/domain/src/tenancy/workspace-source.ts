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

/**
 * A path in the source: a directory or a file, as plain segments separated by
 * `/`, relative to the repository's root. A trailing `/` is dropped.
 *
 * Globs are refused for now: the sync job places a file by the longest
 * literal path it lies under, and globs arrive with the manifest, which
 * narrows a widened glob again when it reads.
 */
export function checkSourcePath(value: string): Result<string, string> {
  if (value.length > MAX_SOURCE_PATH_LENGTH) {
    return err(`The path is longer than ${MAX_SOURCE_PATH_LENGTH} characters.`)
  }
  const path = value.replace(/\/+$/u, '')
  const segments = path.split('/')
  const plain = segments.every(
    (segment) =>
      segment !== '' && segment !== '.' && segment !== '..' && !UNSAFE_IN_SEGMENT.test(segment),
  )
  if (!plain) {
    return err(`"${value}" is not a relative path of plain segments separated by "/".`)
  }
  if (GLOB_CHARACTERS.test(path)) {
    return err(`"${value}" is a glob; name a directory or a file.`)
  }
  return ok(path)
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
