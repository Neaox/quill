/**
 * Commit encoding.
 *
 * Header lines, a blank line, then the message. Identities are
 * `Name <email> <unix seconds> <±hhmm>`; the package always writes `+0000`
 * because a revision has no meaningful local timezone.
 */

import { GitObjectError } from './objects.ts'

export interface GitIdentity {
  readonly name: string
  readonly email: string
  /** Unix seconds. */
  readonly when: number
  /** Numeric timezone offset such as `+0000`. */
  readonly timezone: string
}

export interface GitCommit {
  readonly tree: string
  readonly parents: readonly string[]
  readonly author: GitIdentity
  readonly committer: GitIdentity
  readonly message: string
}

export const UTC = '+0000'

/**
 * Characters that cannot appear in an identity, because the header syntax
 * is built from them: a newline starts a header line, and the angle brackets
 * delimit the email. A NUL is added because a C reader stops at one, so a name
 * carrying it would mean one thing to git and another to this package.
 */
const IDENTITY_CRUD = /[<>\n\r\0]/g

/** What an identity falls back to when sanitising leaves nothing at all. */
const UNKNOWN_NAME = 'Unknown'
const UNKNOWN_EMAIL = 'unknown@invalid'

function withoutCrud(value: string, fallback: string): string {
  const stripped = value.replaceAll(IDENTITY_CRUD, '').trim()
  return stripped === '' ? fallback : stripped
}

/**
 * An identity as it can safely be written, which is what it reads back as.
 *
 * A display name is user input, and a user who can put a newline in one can
 * otherwise write commit headers of their choosing — a second `parent` line,
 * say, which breaks `git fsck` and clone, or a line that poisons the trailer
 * block the revisions index is rebuilt from. git strips the same characters
 * when it builds an identity, and so does this.
 */
export function sanitiseIdentity(identity: GitIdentity): GitIdentity {
  return {
    ...identity,
    name: withoutCrud(identity.name, UNKNOWN_NAME),
    email: withoutCrud(identity.email, UNKNOWN_EMAIL),
  }
}

function encodeIdentity(identity: GitIdentity): string {
  const safe = sanitiseIdentity(identity)
  return `${safe.name} <${safe.email}> ${safe.when} ${safe.timezone}`
}

function decodeIdentity(value: string): GitIdentity {
  const open = value.lastIndexOf(' <')
  const close = value.indexOf('>', open + 1)
  const lastSpace = value.lastIndexOf(' ')
  const when = Number(value.slice(close + 2, lastSpace))
  if (open === -1 || close === -1 || !Number.isInteger(when)) {
    throw new GitObjectError(`Malformed identity "${value}"`)
  }
  return {
    name: value.slice(0, open),
    email: value.slice(open + 2, close),
    when,
    timezone: value.slice(lastSpace + 1),
  }
}

export function encodeCommit(commit: GitCommit): Buffer {
  const headers = [
    `tree ${commit.tree}`,
    ...commit.parents.map((parent) => `parent ${parent}`),
    `author ${encodeIdentity(commit.author)}`,
    `committer ${encodeIdentity(commit.committer)}`,
  ]
  const message = commit.message.endsWith('\n') ? commit.message : `${commit.message}\n`
  return Buffer.from(`${headers.join('\n')}\n\n${message}`, 'utf8')
}

export function decodeCommit(body: Buffer): GitCommit {
  const text = body.toString('utf8')
  const separator = text.indexOf('\n\n')
  if (separator === -1) throw new GitObjectError('Commit has no message separator')
  const parents: string[] = []
  let tree: string | null = null
  let author: GitIdentity | null = null
  let committer: GitIdentity | null = null
  for (const line of text.slice(0, separator).split('\n')) {
    const space = line.indexOf(' ')
    const value = line.slice(space + 1)
    switch (line.slice(0, space)) {
      case 'tree':
        tree = value
        break
      case 'parent':
        parents.push(value)
        break
      case 'author':
        author = decodeIdentity(value)
        break
      case 'committer':
        committer = decodeIdentity(value)
        break
      default:
        break
    }
  }
  if (tree === null || author === null || committer === null) {
    throw new GitObjectError('Commit is missing a tree, an author, or a committer')
  }
  return { tree, parents, author, committer, message: text.slice(separator + 2) }
}
