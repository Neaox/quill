/**
 * The `DocumentFormat` adapter (ADR-062, "One truth"): how a document is
 * parsed, rendered, inspected and compared, with `@quill/markdown`'s block
 * registry and `@quill/highlight`. It holds no server runtime, so the server
 * and the command-line tool run the same code.
 */
export { createDocumentFormat } from './document-format.ts'
export type { DocumentFormatOptions, DraftContent } from './document-format.ts'
export { documentTitle, retitleDocument } from './document-title.ts'
export {
  BUILT_DOCUMENT_WORKER,
  createDocumentWorkPool,
  DOCUMENT_WORKER_SOURCE,
  defaultPoolSize,
  documentWorkerModule,
  workerManifest,
} from './document-work-pool.ts'
export type { DocumentWorkPool, DocumentWorkPoolOptions } from './document-work-pool.ts'
export { createDrawioText, zlibInflate } from './drawing-text.ts'
export { createHighlighter, MAX_EMBEDDED_HIGHLIGHT_CHARS } from './highlighter.ts'
export type { HighlighterOptions } from './highlighter.ts'
export { createKeptByText, createParsedTrees, KEPT_TEXT_MAX_CHARS } from './parsed-trees.ts'
export type { KeptByText, ParsedTrees } from './parsed-trees.ts'
export { incompleteRequiredSections } from './required-sections.ts'
