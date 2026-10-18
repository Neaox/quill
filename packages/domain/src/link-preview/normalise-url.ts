/**
 * The cache key for a link preview (ADR-042): two spellings of the same page
 * must land on one snapshot, or the same link is fetched, stored and refreshed
 * once per spelling.
 *
 * What is folded away is exactly what cannot change which page loads:
 * scheme and host case, the default port, the fragment (except a line range), parameters that only
 * identify a click, and the order of the remaining parameters. Everything else
 * is kept as written, because a path or a real parameter can name a different
 * page, and a trailing slash is not ours to guess about.
 */

/**
 * Parameters added by an ad, mail or social platform to follow a click. A
 * maintained list, so a name is added here rather than matched by pattern:
 * a pattern wide enough to be useful would eat a real parameter.
 */
const TRACKING_PARAMETERS: ReadonlySet<string> = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  '_ga',
  '_gl',
])

/** `utm_*` (Google Analytics campaigns) and `mc_*` (Mailchimp). */
const TRACKING_PREFIXES: readonly string[] = ['utm_', 'mc_']

function isTracking(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    TRACKING_PARAMETERS.has(lower) || TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))
  )
}

/**
 * `#L10` and `#L10-L20`, the fragment a code host uses to select lines. Unlike
 * `#section-2`, it changes what the link is *about* (a permalink to ten lines is not a
 * permalink to the file), so two such links must not share a snapshot.
 */
const LINE_RANGE = /^#L\d{1,7}(?:-L\d{1,7})?$/u

/**
 * Longer than any link a person means to share, and the bound on what every
 * later step (pattern matching, fetching, storing as a key) is asked to chew.
 */
export const MAX_URL_LENGTH = 4096

/**
 * The normalised URL, or `null` when this is not something a preview can be
 * made for: not a URL, not `http(s)`, or carrying credentials (which must
 * never become part of a stored key).
 */
export function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length > MAX_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null

  if (!LINE_RANGE.test(url.hash)) url.hash = ''
  const kept = new URLSearchParams()
  for (const [name, value] of url.searchParams) {
    if (!isTracking(name)) kept.append(name, value)
  }
  // `sort` is stable, so repeated names keep their relative order: `a=2&a=1`
  // is a different request from `a=1&a=2`.
  kept.sort()
  url.search = kept.toString()
  return url.href
}
