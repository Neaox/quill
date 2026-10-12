import type { DocumentFormat } from '../ports/document-format.ts'
import type { DraftRow } from '../ports/persistence.ts'
import { readDraftContent } from './publish-document.ts'

/**
 * The record of who wrote what in a draft, as it is after `by` saves `ast` over what the
 * draft held (`DocumentFormat.stampAuthorship`).
 *
 * The record is for the people reading a comparison, never something a save depends on,
 * so a draft it cannot read, on either side, is saved all the same with its record left as
 * it was: `undefined` says so, and the repository keeps what it has.
 */
export function stampDraftAuthorship(
  format: Pick<DocumentFormat, 'stampAuthorship'>,
  previous: Pick<DraftRow, 'ast' | 'authorship'> | null,
  ast: unknown,
  stamp: { readonly by: string; readonly at: Date },
): unknown {
  const before = previous === null ? null : readDraftContent(previous.ast)
  const after = readDraftContent(ast)
  if (previous === null || before === null || after === null) return undefined
  return format.stampAuthorship({
    previous: before,
    next: after,
    authorship: previous.authorship,
    by: stamp.by,
    at: stamp.at.toISOString(),
  })
}
