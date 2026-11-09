/**
 * The words a person reads about a repository's sync (ADR-061): why it
 * stopped, why a file was not stored, and a revision short enough to read.
 * One place, so the notification and the source's page say the same thing.
 */

const FAILURE: Readonly<Record<string, string>> = {
  'git-unavailable': 'the server has no usable git',
  'git-too-old': 'the server’s git is too old',
  'remote-not-allowed': 'its address is not allowed',
  'blocked-by-outbound-policy': 'the instance may not reach its host',
  'credential-unavailable': 'its credential could not be read',
  'invalid-path': 'a path it names is not allowed',
  'branch-not-found': 'its branch was not found',
  'unknown-revision': 'a revision it needed is missing',
  'history-rewritten': 'its history was rewritten',
  'file-missing': 'a file it needed is missing',
  timeout: 'the repository took too long to answer',
  'output-too-large': 'the repository sent more than the limit allows',
  'command-failed': 'git could not read the repository',
  'store-moved': 'something else wrote the workspace while it synced',
  'store-refused': 'the workspace refused what the sync gave it',
  'invalid-manifest': 'its manifest does not read',
  unexpected: 'something unexpected went wrong',
}

/** Why a sync stopped, as the end of a sentence. */
export function describeSourceFailure(reason: string): string {
  return FAILURE[reason] ?? 'the repository could not be read'
}

const REFUSED: Readonly<Record<string, string>> = {
  'too-large': 'Too large',
  'not-utf8': 'Not UTF-8 text',
  'symbolic-link': 'A symbolic link',
  'outside-collections': 'Outside every collection',
}

/** Why a file was not stored, as a table cell. */
export function describeRefusal(reason: string): string {
  return REFUSED[reason] ?? 'Not stored'
}

/** A source revision short enough to read; the whole one goes in a title. */
export function shortRevision(revision: string): string {
  return revision.slice(0, 12)
}
