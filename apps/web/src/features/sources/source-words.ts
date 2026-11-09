/**
 * The words a person reads about a repository's sync (ADR-061): why it
 * stopped, why a file was not stored, where a manifest went wrong, and a
 * revision short enough to read. One place, so the notification and the
 * source's page say the same thing.
 */

const FAILURE: Readonly<Record<string, string>> = {
  'git-unavailable': 'Git isn’t installed on the server, or can’t be run.',
  'git-too-old': 'The server’s Git is too old. Version 2.49 or later is needed.',
  'remote-not-allowed':
    'The repository’s address isn’t allowed. It must start with https:// and hold no password.',
  'blocked-by-outbound-policy': 'This instance isn’t allowed to reach the repository’s host.',
  'credential-unavailable': 'The secret the credential names is missing or can’t be opened.',
  'invalid-path': 'A path in the settings or the manifest isn’t allowed.',
  'branch-not-found': 'The branch wasn’t found in the repository.',
  'unknown-revision': 'A commit the sync needed is missing from the repository.',
  'history-rewritten': 'The branch’s history was rewritten.',
  'file-missing': 'A file the sync needed wasn’t fetched.',
  timeout: 'The repository took too long to answer.',
  'output-too-large': 'The repository sent more than a sync accepts.',
  'command-failed': 'Git couldn’t read the repository.',
  'store-moved': 'Something else changed the workspace while it synced. The next sync tries again.',
  'store-refused': 'The workspace refused a revision from the repository.',
  'invalid-manifest': 'The manifest has a mistake.',
  unexpected: 'Something unexpected went wrong.',
}

/** Why a sync stopped, as a sentence. */
export function describeSourceFailure(reason: string): string {
  return FAILURE[reason] ?? 'The repository couldn’t be read.'
}

const REFUSED: Readonly<Record<string, string>> = {
  'too-large': 'Too large to store',
  'not-utf8': 'Not UTF-8 text',
  'symbolic-link': 'A symbolic link, which is never followed',
  'outside-collections': 'Outside every collection',
}

/** Why a file was not stored, as a phrase. */
export function describeRefusal(reason: string): string {
  return REFUSED[reason] ?? 'Not stored'
}

/** A source revision short enough to read; the whole one goes in a title. */
export function shortRevision(revision: string): string {
  return revision.slice(0, 12)
}

/** Where a manifest went wrong: the file, the line when known, and what is wrong there. */
export interface ManifestProblem {
  readonly path: string
  readonly line: number | null
  readonly problem: string
}

// `<path>, line <n>: <problem>` or `<path>: <problem>`, as the sync job writes
// it, with an optional ` (at <revision>)` the page says once on its own.
const MANIFEST_PROBLEM =
  /^(?<path>[^\s,:][^,:]{0,500}?)(?:, line (?<line>\d{1,9}))?: (?<problem>.+?)(?: \(at [0-9a-f]{4,64}\))?$/su

/** The manifest problem a failure's message names, or null when it names none. */
export function manifestProblem(message: string): ManifestProblem | null {
  const groups = MANIFEST_PROBLEM.exec(message)?.groups
  const path = groups?.['path']
  const problem = groups?.['problem']
  if (path === undefined || problem === undefined) return null
  const line = groups?.['line']
  const sentence = `${problem.charAt(0).toUpperCase()}${problem.slice(1)}`
  return {
    path,
    line: line === undefined ? null : Number(line),
    problem: /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`,
  }
}

/** A failure's message without the revision it ends with, which the page says once on its own. */
export function withoutRevision(message: string): string {
  return message.replace(/ \(at [0-9a-f]{4,64}\)$/u, '')
}
