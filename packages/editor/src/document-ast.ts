import type { MdastDocument } from '@quill/markdown'

/**
 * The document, as everything outside the editor sees it.
 *
 * This is mdast's `Root`: the AST is what a draft stores and what a publish
 * serialises (ADR-021), and editor JSON is never persisted. The type is taken
 * from the Markdown package's own converter result rather than from `mdast`
 * directly, because `@types/mdast` belongs to that package's dependency tree and
 * naming it here would be a second declaration of the same thing.
 */
export type DocumentAst = MdastDocument['tree']

/** One block of a document: mdast's `RootContent`. */
export type DocumentNode = DocumentAst['children'][number]

/**
 * The shape every mdast node has, for the few walks that do not care which node
 * they are looking at. Reading a tree structurally keeps those walks honest about
 * how little they need, and lets them recurse from a block into phrasing content
 * without naming a dozen union members.
 */
export interface MdastNode {
  readonly type: string
  readonly value?: unknown
  readonly name?: unknown
  readonly children?: readonly MdastNode[]
}
