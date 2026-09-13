import type { IndexableDocument, IndexableHeading } from '@quill/application'

import type { documentSearch } from '../db/schema.ts'

/**
 * An `IndexableDocument` as a `document_search` row.
 *
 * Two things are decided here rather than in the schema, because they are
 * about meaning rather than storage:
 *
 * - **Heading weight becomes repetition.** A `tsvector` has one weight letter
 *   per column and headings share column B, so the depth weighting
 *   `IndexableHeading.weight` carries (an `h1` is worth six times an `h6`,
 *   ADR-010) is expressed as term frequency: each heading's text is repeated
 *   by its weight. Headings are short and there are few of them, so the cost
 *   is small and `ts_rank_cd` reads the repetition exactly as the weighting it
 *   is meant to be.
 * - **Tags and owners are folded to lower case.** They are stored here only to
 *   be filtered on, never to be shown — what a reader sees comes from the
 *   document's own front matter — so folding them is what makes
 *   `tag:Runbook` and `tag:runbook` the same question while array containment
 *   stays served by the GIN index.
 */

export type DocumentSearchRow = typeof documentSearch.$inferInsert

export interface IndexEntryInput {
  readonly document: IndexableDocument
  readonly indexedAt: Date
  /**
   * The most body text to index, in UTF-8 bytes. Absent means all of it,
   * which is what every ordinary document gets; `PostgresSearchIndex` sets it
   * only on the retry after PostgreSQL refused a `tsvector` for being too
   * large (see its `index`).
   */
  readonly bodyByteLimit?: number
}

export function toIndexRow(input: IndexEntryInput): DocumentSearchRow {
  const { document } = input
  return {
    documentId: document.documentId,
    workspaceId: document.workspaceId,
    collectionId: document.collectionId,
    path: document.path,
    title: document.title,
    headings: weightedHeadings(document.headings),
    body: truncateToBytes(document.body, input.bodyByteLimit),
    tags: fold(document.tags),
    owners: fold(document.owners),
    status: document.status,
    updatedAt: document.updatedAt,
    revision: document.revision,
    indexVersion: document.version,
    indexedAt: input.indexedAt,
  }
}

function weightedHeadings(headings: readonly IndexableHeading[]): string {
  return headings
    .flatMap((heading) => Array.from({ length: heading.weight }, () => heading.text))
    .join(' ')
}

/** Lower-cased and de-duplicated, so repetition in front matter cannot tilt a filter or a rank. */
function fold(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))]
}

/**
 * At most `limit` UTF-8 bytes of `text`, cut on a character boundary.
 *
 * Counted in bytes because the limit being respected is PostgreSQL's, which
 * is a byte limit on the `tsvector` the column generates, not a limit on
 * JavaScript's UTF-16 code units.
 */
function truncateToBytes(text: string, limit: number | undefined): string {
  if (limit === undefined || Buffer.byteLength(text, 'utf8') <= limit) return text
  const buffer = Buffer.from(text, 'utf8').subarray(0, limit)
  // `toString` on a buffer cut mid-character ends in a replacement character;
  // dropping it keeps the stored text exactly what the document said.
  return buffer.toString('utf8').replace(/�$/, '')
}
