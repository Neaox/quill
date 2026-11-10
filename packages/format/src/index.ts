/**
 * The `DocumentFormat` adapter (ADR-062, "One truth"): how a document is
 * parsed, rendered, inspected and compared, with `@quill/markdown`'s block
 * registry and `@quill/highlight`. It holds no server runtime, so the server
 * and the command-line tool run the same code.
 */
export { createDocumentFormat } from './document-format.ts'
export type { DocumentFormatOptions, DraftContent } from './document-format.ts'
export { documentTitle, retitleDocument } from './document-title.ts'
export { createDrawioText, zlibInflate } from './drawing-text.ts'
export { createHighlighter, MAX_EMBEDDED_HIGHLIGHT_CHARS } from './highlighter.ts'
export type { HighlighterOptions } from './highlighter.ts'
export { incompleteRequiredSections } from './required-sections.ts'
