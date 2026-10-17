import type { DocumentId, ShortId } from '@quill/domain'

import { parseDocumentReference } from './document-path.ts'

/**
 * What becomes of one link in a body served outside the application: left as
 * it is, given the address this surface reads the document at, or reduced to
 * its words. The same shape as `@quill/markdown`'s `LinkRewrite`, which is
 * what applies it to the HTML.
 */
export type SurfaceLink =
  | { readonly kind: 'keep' }
  | { readonly kind: 'href'; readonly href: string }
  | { readonly kind: 'text' }

/** A document a surface shows, by the two handles a link may name it with. */
export interface SurfaceDocument {
  readonly id: DocumentId
  readonly shortId: ShortId
}

const KEEP: SurfaceLink = { kind: 'keep' }
const TEXT: SurfaceLink = { kind: 'text' }

/** An address into the application: a workspace, or a document by any of its forms. */
const APPLICATION_ADDRESS = /^\/(?:w|d)(?:[/?#]|$)/u

/** The document reference in an application address, and the query and section after it. */
const DOCUMENT_ADDRESS = /^(?:\/w\/[^/?#]+)?\/d\/([^/?#]+)(?:\/[^?#]*)?([?#].*)?$/u

/**
 * Decides, link by link, where a body's links to other documents go on a
 * surface that is not the application: the public site, a share link.
 *
 * A link to a document is stored as `/d/<uuid>` (ADR-035), and a reader may
 * have pasted the readable `/w/<workspace>/d/<title>-<key>` before a publish
 * canonicalised it; either way only the key or the id decides. A document the
 * surface shows gets its address there, with the section and query the link
 * named, so it lands where the author pointed. Anything else that addresses
 * the application leads nowhere for this reader, and its address would name a
 * workspace, a title or an id they were never shown (ADR-046: a withdrawn or
 * private page leaks nothing), so it is reduced to its words. Every other link
 * — the web, a section of this page, an attachment, the surface's own pages —
 * is left exactly as written.
 */
export function surfaceLinkRewriter<T extends SurfaceDocument>(
  documents: Iterable<T>,
  hrefOf: (document: T) => string,
): (href: string) => SurfaceLink {
  const byId = new Map<DocumentId, T>()
  const byShortId = new Map<ShortId, T>()
  for (const document of documents) {
    byId.set(document.id, document)
    byShortId.set(document.shortId, document)
  }

  return (href) => {
    if (!APPLICATION_ADDRESS.test(href)) return KEEP
    const [, reference, rest] = DOCUMENT_ADDRESS.exec(href) ?? []
    if (reference === undefined) return TEXT
    const parsed = parseDocumentReference(reference)
    const target =
      parsed === null
        ? undefined
        : parsed.kind === 'uuid'
          ? byId.get(parsed.documentId)
          : byShortId.get(parsed.shortId)
    return target === undefined ? TEXT : { kind: 'href', href: `${hrefOf(target)}${rest ?? ''}` }
  }
}

/** Where a deprecated document's replacement is, as one reader may follow it. */
export interface Replacement {
  readonly href: string
  readonly title: string
}

/**
 * A deprecated document's replacement (`supersededBy`, a document reference)
 * on a surface that is not the application, or `undefined`.
 *
 * The same rule as a link in the body: a replacement the surface shows is
 * named and linked at its address there; anything else — a private page, one
 * outside a share link's scope, a reference that names nothing — is not
 * mentioned at all, because its title is exactly what this reader was never
 * shown (ADR-046, ADR-057).
 */
export function surfaceReplacement<T extends SurfaceDocument & { readonly title: string }>(
  reference: string | undefined,
  documents: Iterable<T>,
  hrefOf: (document: T) => string,
): Replacement | undefined {
  const parsed = reference === undefined ? null : parseDocumentReference(reference)
  if (parsed === null) return undefined
  for (const document of documents) {
    const named =
      parsed.kind === 'uuid'
        ? document.id === parsed.documentId
        : document.shortId === parsed.shortId
    if (named) return { href: hrefOf(document), title: document.title }
  }
  return undefined
}
