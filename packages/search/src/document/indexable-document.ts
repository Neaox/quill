import type { CollectionId, DocumentId, DocumentStatus, WorkspaceId } from '@quill/domain'
import type { Result } from '@quill/domain'
import { err, ok } from '@quill/domain'

/** The version {@link projectIndexableDocument} writes today. */
export const INDEXABLE_DOCUMENT_VERSION = 1

/** One heading, weighted by depth so a title outranks a subsection (ADR-010). */
export interface IndexableHeading {
  readonly text: string
  readonly depth: number
  readonly weight: number
}

/**
 * What a search engine adapter indexes for one published document (ADR-010,
 * quill-plan.md §15). `version` follows rule 17: a value this shape ever
 * writes carries it, and {@link assertSupportedIndexableDocumentVersion} is
 * where a reader dispatches on it, the same discipline `@quill/highlight`'s
 * `unpackRanges` applies to a packed token range.
 */
export interface IndexableDocumentV1 {
  readonly version: 1
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId | null
  readonly path: string
  readonly title: string
  readonly headings: readonly IndexableHeading[]
  readonly body: string
  readonly tags: readonly string[]
  readonly owners: readonly string[]
  readonly status: DocumentStatus
  readonly updatedAt: Date
}

export type IndexableDocument = IndexableDocumentV1

const MAX_HEADING_DEPTH = 6

/**
 * A heading's ranking weight: an `h1` is worth six times an `h6`, and
 * anything deeper or shallower than the levels Markdown headings actually
 * have is clamped rather than producing a weight of zero or a negative one.
 */
export function headingWeight(depth: number): number {
  const clamped = Math.min(Math.max(depth, 1), MAX_HEADING_DEPTH)
  return MAX_HEADING_DEPTH - clamped + 1
}

export interface UnsupportedIndexableDocumentVersion {
  readonly kind: 'unsupported-indexable-document-version'
  readonly version: number
}

/**
 * Confirms `value` carries a version this build knows how to read, before
 * anything else about it is trusted. There is only one version today, so the
 * dispatch is a single case plus a refusal — the shape a second version
 * extends without disturbing this one (rule 17).
 */
export function assertSupportedIndexableDocumentVersion(value: {
  readonly version: number
}): Result<1, UnsupportedIndexableDocumentVersion> {
  switch (value.version) {
    case 1:
      return ok(value.version)
    default:
      return err({ kind: 'unsupported-indexable-document-version', version: value.version })
  }
}
