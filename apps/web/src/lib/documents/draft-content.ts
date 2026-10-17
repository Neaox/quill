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

import type { DocumentAst, DraftAuthor } from '@quill/editor'

/** The version stamped into every draft this platform writes. */
export const DRAFT_CONTENT_VERSION = 1

export interface DraftContent {
  readonly version: number
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** The document tree, opaque here: only the editor and the server read inside it. */
  readonly ast: unknown
  /**
   * Who saved this version, and who last merged offline changes into it
   * (ADR-021, amendment of 2026-10-11). Added within version 1: a reader
   * that does not know them ignores them, and every save writes them afresh,
   * so a merge is announced until the next ordinary save.
   */
  readonly writtenBy?: DraftAuthor
  readonly mergedBy?: DraftAuthor
}

/** What a save stamps on the draft about who wrote it. */
export interface DraftStamp {
  readonly writtenBy?: DraftAuthor
  readonly mergedBy?: DraftAuthor
}

function authorOf(value: unknown): DraftAuthor | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'userId' in value &&
    typeof value.userId === 'string' &&
    'displayName' in value &&
    typeof value.displayName === 'string'
    ? { userId: value.userId, displayName: value.displayName }
    : undefined
}

/** A draft row's stored content, or `null` when this release cannot read it. */
export function readDraftContent(value: unknown): DraftContent | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<DraftContent>
  if (candidate.version !== DRAFT_CONTENT_VERSION) return null
  if (typeof candidate.frontMatter !== 'object' || candidate.frontMatter === null) return null
  const writtenBy = authorOf(candidate.writtenBy)
  const mergedBy = authorOf(candidate.mergedBy)
  return {
    version: candidate.version,
    frontMatter: candidate.frontMatter,
    ast: candidate.ast,
    ...(writtenBy === undefined ? {} : { writtenBy }),
    ...(mergedBy === undefined ? {} : { mergedBy }),
  }
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

/**
 * The same draft with a new tree, its version and front matter carried over,
 * stamped with who wrote it; the previous stamp is not carried over.
 */
export function withDocumentAst(
  content: DraftContent,
  ast: unknown,
  stamp: DraftStamp = {},
): DraftContent {
  return { version: content.version, frontMatter: content.frontMatter, ast, ...stamp }
}
