/**
 * The product's own names as they appear inside a repository: the committer
 * identity and the commit-message trailer keys (ADR-014).
 *
 * They are derived from the brand constants rather than written out, so a
 * rename rewrites them with everything else.
 */

import { BRAND } from '@quill/brand'

export const PRODUCT_NAME = BRAND.name

/** Committer email. `.invalid` is reserved by RFC 2606 and can never route. */
export const PRODUCT_EMAIL = `${BRAND.slug}@${BRAND.slug}.invalid`

/** Repeats once per document in a bulk publish. */
export const DOCUMENT_ID_TRAILER = `${BRAND.name}-Document-Id`

export const CHANGE_NOTE_TRAILER = `${BRAND.name}-Change-Note`
