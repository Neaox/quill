/**
 * `@quill/markdown/extension`: the Markdown extension contract and its
 * registry (ADR-039, `docs/extending/markdown-extensions.md`).
 */
export { defineExtension, extensionProblems } from './contract.ts'
export type {
  DrawingClaim,
  DrawingRendering,
  DrawingSource,
  EditorAction,
  EditorBinding,
  EditorInsert,
  ExtensionSyntax,
  MarkdownExtension,
  SanitizeGrant,
} from './contract.ts'
export { BUILT_IN_EXTENSIONS, createMarkdownRegistry } from './registry.ts'
export type { MarkdownRegistry } from './registry.ts'
