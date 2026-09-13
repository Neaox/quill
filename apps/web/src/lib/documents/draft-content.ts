/**
 * What a draft row holds, as the client reads it.
 *
 * A draft is a persisted format, so it carries a version and every reader
 * dispatches on it rather than assuming today's shape (ADR-033). The server
 * has its own reader in `packages/application`; the web app cannot import
 * that layer (ARCHITECTURE.md), and a wire format understood by only one side
 * is not a format, so this is the same contract stated where the browser can
 * use it. The two are kept honest by the API: a draft written by one and read
 * by the other is exactly what the end-to-end journey exercises.
 *
 * The editor never sees this envelope. It takes and returns an mdast root;
 * the front matter travels beside it untouched, which is what keeps a
 * document's metadata intact through an edit that never looked at it.
 */

import type { DocumentAst } from '@quill/editor'

/** The version stamped into every draft this platform writes. */
export const DRAFT_CONTENT_VERSION = 1

export interface DraftContent {
  readonly version: number
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** The document tree, opaque here: only the editor and the server read inside it. */
  readonly ast: unknown
}

/** A draft row's stored content, or `null` when this release cannot read it. */
export function readDraftContent(value: unknown): DraftContent | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<DraftContent>
  if (candidate.version !== DRAFT_CONTENT_VERSION) return null
  if (typeof candidate.frontMatter !== 'object' || candidate.frontMatter === null) return null
  return { version: candidate.version, frontMatter: candidate.frontMatter, ast: candidate.ast }
}

/**
 * Whether a stored tree is one the editor can open.
 *
 * A version this release understands can still hold a tree it does not — a
 * draft truncated by a failed write, or a shape from before the format was
 * versioned — so the tree is checked as well as the envelope. `root` is
 * mdast's own discriminant, which is the one thing every document tree has.
 */
export function isDocumentTree(value: unknown): value is DocumentAst {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'root'
  )
}

/** The same draft with a new tree, its version and front matter carried over. */
export function withDocumentAst(content: DraftContent, ast: unknown): DraftContent {
  return { version: content.version, frontMatter: content.frontMatter, ast }
}
