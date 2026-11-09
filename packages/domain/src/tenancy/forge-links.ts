import { err, ok } from '../result.ts'
import type { Result } from '../result.ts'

/**
 * Where a sourced document's link to a repository file the source does not
 * hold goes (ADR-061, "Relative links, resolved at render"): a file outside
 * the source's paths, an excluded one, or one that is not a document.
 *
 * `forge` links it to the file on the forge at the commit the page was
 * synced from, never at the head, so the link shows the file as it was then.
 * `text` shows the link's words with no address, for readers who cannot open
 * the repository.
 */
export const SOURCE_OUTSIDE_LINK_SETTINGS = ['forge', 'text'] as const
export type SourceOutsideLinkSetting = (typeof SOURCE_OUTSIDE_LINK_SETTINGS)[number]

export const MAX_FORGE_VIEW_TEMPLATE_LENGTH = 2048

/** What a view template names: the commit, and the file's path in the repository. */
const COMMIT = '{commit}'
const PATH = '{path}'
/** The scheme and host of an address as written, up to the `/` its path starts with. */
const AUTHORITY = /^https:\/\/[^/]*/iu

/**
 * A forge's address for a file at a commit, with `{commit}` and `{path}`
 * where those go, such as
 * `https://git.example.com/team/handbook/src/{commit}/{path}`.
 *
 * Each placeholder appears once, in the address's path, and nothing else is
 * in braces. The address is `https` with no credentials, query or fragment:
 * it is shown to every reader of a page.
 */
export function checkForgeViewTemplate(value: string): Result<string, string> {
  if (value.length > MAX_FORGE_VIEW_TEMPLATE_LENGTH) {
    return err(`The address is longer than ${MAX_FORGE_VIEW_TEMPLATE_LENGTH} characters.`)
  }
  if (count(value, COMMIT) !== 1 || count(value, PATH) !== 1) {
    return err('The address must name {commit} and {path} once each.')
  }
  const filled = value.replace(COMMIT, 'c').replace(PATH, 'p')
  if (/[{}]/u.test(filled)) return err('Only {commit} and {path} may be in braces.')
  if (!URL.canParse(filled)) return err(`"${value}" is not an address.`)
  const authority = AUTHORITY.exec(value)?.[0].length
  if (authority === undefined) return err('The address must start with https://.')
  const url = new URL(filled)
  if (url.username !== '' || url.password !== '') {
    return err('The address must not carry a user name or password.')
  }
  if (url.search !== '' || url.hash !== '') {
    return err('The address must not have a query or a fragment.')
  }
  if (value.indexOf(COMMIT) < authority || value.indexOf(PATH) < authority) {
    return err('{commit} and {path} belong in the address’s path, after its host.')
  }
  return ok(value)
}

function count(value: string, part: string): number {
  return value.split(part).length - 1
}

/**
 * The view template of the forges whose addresses are known, read from the
 * source's remote; null for any other host, which names its own.
 */
export function defaultForgeViewTemplate(remote: string): string | null {
  if (!URL.canParse(remote)) return null
  const url = new URL(remote)
  if (url.protocol !== 'https:') return null
  const repository = url.pathname.replace(/\/+$/u, '').replace(/\.git$/u, '')
  if (repository.split('/').filter((segment) => segment !== '').length < 2) return null
  const base = `https://${url.host}${repository}`
  switch (url.hostname.toLowerCase()) {
    case 'github.com':
      return `${base}/blob/${COMMIT}/${PATH}`
    case 'gitlab.com':
      return `${base}/-/blob/${COMMIT}/${PATH}`
    case 'bitbucket.org':
      return `${base}/src/${COMMIT}/${PATH}`
    default:
      return null
  }
}

/** A file at a commit on the forge, each segment of its path encoded. */
export function forgeViewUrl(template: string, commit: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return template.replace(COMMIT, encodeURIComponent(commit)).replace(PATH, encoded)
}
