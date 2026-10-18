/**
 * The address of another Quill document, as a link preview key (ADR-042,
 * "Internal links").
 *
 * An internal link is the first-party case of layer 1: it is resolved by id
 * when a page is read, never fetched and never stored, so its key is only
 * ever an address on this instance. The key is `/d/<reference>`, which is the
 * canonical form every document link is rewritten to when it is published
 * (ADR-035). It cannot collide with an external key, because those are
 * absolute `http(s)` URLs.
 */

const REFERENCE = String.raw`[\p{Letter}\p{Number}%_-]+`
const INTERNAL = new RegExp(String.raw`^(?:/w/${REFERENCE})?/d/(${REFERENCE})(?:[#?].*)?$`, 'u')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * The key for a link to a document of this instance, or `null` when the
 * address is anything else: external, protocol-relative, or not a document.
 * A UUID is lower-cased; a readable reference (`the-title-<key>`) is kept as
 * written, because only the server can say which document it names.
 */
export function internalDocumentAddress(url: string): string | null {
  const reference = INTERNAL.exec(url.trim())?.[1]
  if (reference === undefined) return null
  return `/d/${UUID.test(reference) ? reference.toLowerCase() : reference}`
}

/** Whether a preview key is an internal address rather than an external URL. */
export function isInternalAddress(key: string): boolean {
  return key.startsWith('/d/')
}

/** The reference a key carries: the part after `/d/`. */
export function internalReference(key: string): string {
  return key.slice('/d/'.length)
}
