import type { DocumentId } from '@quill/domain'

/**
 * The order of a parent's documents (ADR-049): by sort key, a document with
 * no key after every one with a key; then oldest first, so a new document
 * goes at the bottom and nothing moves when it does; then by id, so the
 * order is total. The navigation tree, child pages lists and the public site
 * read it alike.
 */

export interface SiblingOrdered {
  readonly id: DocumentId
  readonly sortKey: number | null
  readonly createdAt: Date
}

/** `a - b` over keys where a missing key is last; two missing keys tie (the NaN is falsy). */
export function compareSortKeys(left: SiblingOrdered, right: SiblingOrdered): number {
  return (left.sortKey ?? Number.POSITIVE_INFINITY) - (right.sortKey ?? Number.POSITIVE_INFINITY)
}

export function compareSiblings(left: SiblingOrdered, right: SiblingOrdered): number {
  return (
    compareSortKeys(left, right) ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id, 'en')
  )
}
