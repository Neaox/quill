import type { Result } from '@quill/domain'
import { err, ok } from '@quill/domain'

/**
 * What a search engine adapter indexes for one published document (ADR-010,
 * quill-plan.md §15). The shapes belong to the search port
 * (`@quill/application`'s `ports/search-index.ts`) and are re-exported here;
 * the version constant, the heading weighting, and the version check are this
 * package's, because they are behaviour rather than contract.
 */

export type {
  Contributor,
  IndexableDocument,
  IndexableDocumentV1,
  IndexableDocumentV2,
  IndexableDocumentV3,
  IndexableHeading,
} from '@quill/application/ports'

/** The version {@link projectIndexableDocument} writes today. */
export const INDEXABLE_DOCUMENT_VERSION = 3

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
 * anything else about it is trusted. Each version this package has shipped is
 * a case, and a version it has not is refused (rule 17): version 1 is a
 * document indexed before anyone's name was; version 2 knows who has published;
 * version 3 carries the generic properties `prop:` asks about.
 */
export function assertSupportedIndexableDocumentVersion(value: {
  readonly version: number
}): Result<1 | 2 | 3, UnsupportedIndexableDocumentVersion> {
  switch (value.version) {
    case 1:
    case 2:
    case 3:
      return ok(value.version)
    default:
      return err({ kind: 'unsupported-indexable-document-version', version: value.version })
  }
}
