import { err, ok } from '../result.ts'
import type { Result } from '../result.ts'

/**
 * What an organisation lets Quill do about links (ADR-042, "Policy"): whether
 * previews exist at all, how rich they may be, and which sites Quill may talk
 * to on its people's behalf.
 *
 * This governs **Quill's own requests**, not what people may write. A link to
 * a blocked site is still a working link; Quill just never contacts that site
 * to describe it. That is also why the check is on every request a preview
 * makes (the page, a redirect it lands on, an oEmbed endpoint, an image) and
 * not only on the URL that was pasted: a block list checked once is a block
 * list a redirect walks around.
 *
 * Pure and dependency-free so the server enforces it and the settings screen
 * can validate a pattern as it is typed, with one parser for both.
 */

/**
 * - `off`: nothing is fetched; every link is a plain link.
 * - `text`: titles, descriptions and site names, but no pictures are fetched,
 *   stored or shown. For organisations that want the context without the
 *   third-party images.
 * - `rich`: everything, including thumbnails and favicons.
 */
export const LINK_PREVIEW_MODES = ['off', 'text', 'rich'] as const

export type LinkPreviewMode = (typeof LINK_PREVIEW_MODES)[number]

export interface LinkPreviewPolicy {
  readonly mode: LinkPreviewMode
  /** When not empty, only matching URLs may be contacted. */
  readonly allow: readonly string[]
  /** Matching URLs are never contacted. Wins over `allow`. */
  readonly block: readonly string[]
}

export const DEFAULT_LINK_PREVIEW_POLICY: LinkPreviewPolicy = {
  mode: 'rich',
  allow: [],
  block: [],
}

export const MAX_POLICY_PATTERNS = 500
const MAX_PATTERN_LENGTH = 300

export type PatternError =
  | 'empty'
  | 'too_long'
  /** Not a host: spaces, a port, credentials, a wildcard anywhere but the front. */
  | 'invalid_host'
  | 'invalid_path'

export interface UrlPattern {
  /** Lower-case, punycode, no trailing dot. */
  readonly host: string
  /** `true` for `*.example.com`: subdomains only, not `example.com` itself. */
  readonly subdomainsOnly: boolean
  /** A path prefix without a trailing slash, or `''` for the whole site. */
  readonly pathPrefix: string
}

/** A bare hostname: letters (of any script), digits, hyphens and dots; an IPv4 literal fits too. */
const HOST_SHAPE = /^[\p{L}\p{N}.-]+$/u

function canonicalHost(host: string): string | null {
  try {
    // `URL` lower-cases, converts internationalised names to punycode, and
    // normalises numeric forms (`0x7f.1` is `127.0.0.1`), which is the form a
    // request's own host will take when it is compared.
    return new URL(`http://${host}/`).hostname.replace(/\.$/u, '')
  } catch {
    return null
  }
}

/**
 * Reads one pattern.
 *
 * The grammar is deliberately small, and has no regular expressions: an admin
 * can read what it does, and it cannot be made to backtrack.
 *
 *     example.com               that host
 *     *.example.com             any subdomain (list `example.com` too for both)
 *     example.com/docs          that host, paths at and under /docs
 *     *.example.com/internal/*  a trailing * is allowed and means the same
 *
 * A scheme, if written, is ignored, since a preview is made over either.
 */
export function parseUrlPattern(raw: string): Result<UrlPattern, PatternError> {
  const text = raw.trim().replace(/^https?:\/\//iu, '')
  if (text === '') return err('empty')
  if (text.length > MAX_PATTERN_LENGTH) return err('too_long')

  const slash = text.indexOf('/')
  const hostPart = slash === -1 ? text : text.slice(0, slash)
  const pathPart = slash === -1 ? '' : text.slice(slash)

  const subdomainsOnly = hostPart.startsWith('*.')
  const bareHost = subdomainsOnly ? hostPart.slice(2) : hostPart
  if (bareHost === '' || !HOST_SHAPE.test(bareHost)) return err('invalid_host')
  const host = canonicalHost(bareHost)
  if (host === null || host === '') return err('invalid_host')

  // Only a trailing `*` (and trailing slashes) can follow a path.
  const prefix = pathPart.replace(/\/?\*?$/u, '').replace(/\/+$/u, '')
  if (prefix.includes('*') || prefix.includes('?') || prefix.includes('#'))
    return err('invalid_path')
  return ok({ host, subdomainsOnly, pathPrefix: prefix })
}

function matches(pattern: UrlPattern, url: URL): boolean {
  const host = url.hostname.replace(/\.$/u, '')
  const hostMatches = pattern.subdomainsOnly
    ? host.endsWith(`.${pattern.host}`)
    : host === pattern.host
  if (!hostMatches) return false
  if (pattern.pathPrefix === '') return true
  // On a segment boundary: `/docs` covers `/docs` and `/docs/x`, never `/docsx`.
  return url.pathname === pattern.pathPrefix || url.pathname.startsWith(`${pattern.pathPrefix}/`)
}

export interface CompiledLinkPolicy {
  readonly mode: LinkPreviewMode
  /** Whether a picture may be fetched, stored and shown. */
  readonly images: boolean
  /** Whether Quill may contact this URL. */
  permits(url: URL): boolean
}

export type PolicyError =
  | { readonly kind: 'too_many'; readonly list: 'allow' | 'block' }
  | {
      readonly kind: 'pattern'
      readonly list: 'allow' | 'block'
      readonly pattern: string
      readonly error: PatternError
    }

function compileList(
  list: 'allow' | 'block',
  raw: readonly string[],
): Result<readonly UrlPattern[], PolicyError> {
  if (raw.length > MAX_POLICY_PATTERNS) return err({ kind: 'too_many', list })
  const patterns: UrlPattern[] = []
  for (const pattern of raw) {
    const parsed = parseUrlPattern(pattern)
    if (!parsed.ok) return err({ kind: 'pattern', list, pattern, error: parsed.error })
    patterns.push(parsed.value)
  }
  return ok(patterns)
}

/**
 * Validates a policy and makes it ready to ask questions of. A policy with a
 * pattern that does not parse is refused whole: a block list that silently
 * skips the entry the admin mistyped is worse than one that says so.
 */
export function compileLinkPolicy(
  policy: LinkPreviewPolicy,
): Result<CompiledLinkPolicy, PolicyError> {
  const allow = compileList('allow', policy.allow)
  if (!allow.ok) return allow
  const block = compileList('block', policy.block)
  if (!block.ok) return block

  return ok({
    mode: policy.mode,
    images: policy.mode === 'rich',
    permits(url) {
      if (policy.mode === 'off') return false
      if (block.value.some((pattern) => matches(pattern, url))) return false
      return allow.value.length === 0 || allow.value.some((pattern) => matches(pattern, url))
    },
  })
}
