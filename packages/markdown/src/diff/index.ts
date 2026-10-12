/**
 * Comparing two versions of a document, and the primitives a three-way merge
 * is built from (ADR-021's amendment of 2026-10-11: one engine, block matching
 * by content and position, then words, rows, items and lines within blocks).
 *
 * - `diffSequences`: the edit script between any two sequences (Myers).
 * - `changeRuns` and `diffText`: edit scripts as readable runs; words.
 * - `alignBlocks`: which block of one version each block of another is —
 *   unchanged, added, removed, changed or moved.
 * - `mergePhrasing`: the word-level changes inside one block, as phrasing.
 * - `compareLines`: text by line, with each changed line's words.
 * - `compareDocuments` and `renderComparison`: two revisions as one tree a
 *   reader can follow, drawn by the reader's own renderer.
 *
 * Nothing here knows where a document is stored or how its revisions are
 * kept; it compares trees and text.
 */

export type { Edit } from './sequence.ts'
export { diffSequences, MAX_EDIT_DISTANCE } from './sequence.ts'
export type { Change, Run, RunOptions, TextDiff, TextSegment } from './runs.ts'
export { changeRuns, diffText, isWord, tokenize, wordCount } from './runs.ts'
export type { AlignOptions, BlockAlignment } from './blocks.ts'
export { alignBlocks, PAIRING_THRESHOLD, similarity } from './blocks.ts'
export type { MergedPhrasing } from './inline.ts'
export { hasChanges, mergePhrasing } from './inline.ts'
export type { LineChange, LineComparison } from './lines.ts'
export { compareLines, linesOf } from './lines.ts'
export { nodeKey } from './keys.ts'
export { plainText } from './text.ts'
export type { BlockChange, DiffCode, DiffDeletion, DiffInsertion } from './nodes.ts'
export type { ChangedBlock, ComparedChange, DocumentComparison, PropertyChange } from './compare.ts'
export { compareDocuments, compareProperties } from './compare.ts'
export type {
  ComparisonDetail,
  ComparisonSection,
  ComparisonSummary,
  RenderedComparison,
  SectionedChange,
} from './render.ts'
export { renderComparison } from './render.ts'
export type { RevertContext } from './revert.ts'
export { revertChanges, revertibleChanges } from './revert.ts'
export type { Authorship, Stamp } from './authorship.ts'
export {
  attributeChanges,
  NO_AUTHORSHIP,
  readAuthorship,
  REMOVALS_KEPT,
  removedBy,
  stampEdit,
  writtenBy,
} from './authorship.ts'
