/**
 * What an author typed into a link box, as an address a document may carry.
 *
 * ADR-011 allows a link to be http(s), mailto, or a reference relative to the
 * page: the renderer drops anything else when it publishes, so an editor that
 * accepted a `javascript:` address would let a link be written that silently
 * stops being one. Refusing it here says so while the author can still fix it.
 * A bare domain is what people type and mean `https://` by, so it is completed
 * rather than refused.
 */

const SCHEME = /^([a-z][a-z\d+.-]*):/i
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto'])
const RELATIVE = /^(?:\/(?!\/)|#|\.{1,2}\/|\?)/
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/
const DOMAIN = /^[^\s/@]+\.[^\s/@]{2,}(?:[/?#]\S*)?$/

/** The address to store, or `null` when what was typed is not one a document may link to. */
export function normaliseHref(typed: string): string | null {
  const href = typed.trim()
  if (href === '' || /\s/.test(href)) return null

  const scheme = SCHEME.exec(href)?.[1]?.toLowerCase()
  if (scheme !== undefined) return ALLOWED_SCHEMES.has(scheme) ? href : null

  if (RELATIVE.test(href)) return href
  if (EMAIL.test(href)) return `mailto:${href}`
  if (DOMAIN.test(href)) return `https://${href}`
  return null
}

/** Whether an address leaves the document, which is when it is worth opening in a new tab. */
export function isExternal(href: string): boolean {
  return /^https?:/i.test(href)
}
