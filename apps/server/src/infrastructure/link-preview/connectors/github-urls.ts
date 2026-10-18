/**
 * What a github.com link points at (ADR-042, the GitHub connector).
 *
 * The connector asks `api.github.com` about a link, and what it asks is built
 * **only from the pieces this module has validated**: an owner and a repository
 * that match GitHub's own naming rules, a number, a commit id, and a path whose
 * every segment is plain. The pasted URL never decides which host is contacted or
 * what the request path contains beyond those pieces, so a crafted link (an
 * encoded slash, a dot segment, a look-alike host) cannot steer the credentialed
 * request anywhere else on the API.
 */

export const GITHUB_HOSTS = ['github.com', 'www.github.com'] as const

export interface LineRange {
  readonly start: number
  readonly end: number
}

interface Repository {
  readonly owner: string
  readonly repo: string
}

export type GitHubTarget =
  | (Repository & { readonly kind: 'repository' })
  | (Repository & { readonly kind: 'pull' | 'issue'; readonly number: number })
  | (Repository & {
      readonly kind: 'code'
      readonly sha: string
      readonly path: string
      /** Null when the link names no lines. */
      readonly lines: LineRange | null
    })

/** GitHub's rules for a user or organisation name: alphanumerics and single hyphens, at most 39. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u
/** Repository names: letters, digits, `.`, `_` and `-`, up to 100 characters. */
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/u
/** A full commit id, SHA-1 or SHA-256. Only a commit id is a permalink: a branch moves. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u
const NUMBER = /^[1-9][0-9]{0,9}$/u
const LINES = /^#L(\d{1,7})(?:-L(\d{1,7}))?$/u

/** First path segments that are GitHub's own pages and never an owner. */
const RESERVED_OWNERS: ReadonlySet<string> = new Set([
  'about',
  'account',
  'apps',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'signup',
  'sponsors',
  'topics',
  'trending',
  'users',
])

// eslint-disable-next-line no-control-regex -- refusing control characters is the point.
const CONTROL = /[\u0000-\u001F\u007F]/u

/** One path segment, decoded, or null when it could name anything but a plain file or directory. */
function plainSegment(raw: string): string | null {
  let segment: string
  try {
    segment = decodeURIComponent(raw)
  } catch {
    return null
  }
  const refused =
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    CONTROL.test(segment)
  return refused ? null : segment
}

function lineRange(hash: string): LineRange | null {
  const match = LINES.exec(hash)
  if (match === null) return null
  const first = Number(match[1])
  const last = match[2] === undefined ? first : Number(match[2])
  return first <= last ? { start: first, end: last } : { start: last, end: first }
}

function codeTarget(
  repository: Repository,
  sha: string,
  pathSegments: readonly string[],
  hash: string,
): GitHubTarget | null {
  if (!COMMIT.test(sha) || pathSegments.length === 0) return null
  const decoded = pathSegments.map(plainSegment)
  if (!decoded.every((segment): segment is string => segment !== null)) return null
  return { kind: 'code', ...repository, sha, path: decoded.join('/'), lines: lineRange(hash) }
}

export function parseGitHubUrl(url: URL): GitHubTarget | null {
  if (!(GITHUB_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())) return null
  const [owner = '', repo = '', section, id, ...rest] = url.pathname.split('/').slice(1)
  if (!OWNER.test(owner) || RESERVED_OWNERS.has(owner.toLowerCase())) return null
  if (!REPOSITORY.test(repo) || repo === '.' || repo === '..') return null
  const repository: Repository = { owner, repo }

  if (section === undefined || (section === '' && id === undefined)) {
    return { kind: 'repository', ...repository }
  }
  if (section === 'pull' || section === 'issues') {
    if (id === undefined || !NUMBER.test(id)) return null
    return { kind: section === 'pull' ? 'pull' : 'issue', ...repository, number: Number(id) }
  }
  if (section === 'blob' && id !== undefined) return codeTarget(repository, id, rest, url.hash)
  return null
}
