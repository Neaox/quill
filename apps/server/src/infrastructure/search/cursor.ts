import type { DocumentId } from '@quill/domain'

/**
 * Where the next page of results starts (ADR-010).
 *
 * Keyset, not offset: the cursor carries the last hit's score and id, so a
 * document published between two pages cannot shift the window and make a
 * result appear twice or not at all. It carries three other things, each
 * because a later page must be scored the same way the first one was:
 *
 * - **`at`**, the instant the first page was scored at. The recency boost
 *   decays with time, so scoring page two against a later `now` would give
 *   every document a slightly different score and the keyset comparison would
 *   no longer mean anything.
 * - **`arm`**, whether the first page's scores came from the AND-ed query or
 *   the OR-ed widening (`postgres-search-index.ts`). The two score the same
 *   document differently, so switching arms mid-page-through would reorder
 *   the very list being paged.
 * - **`from`**, where in the caller's workspace order the batch of workspaces
 *   this page searched begins (`visible-documents.ts`). Permissions are
 *   resolved for a bounded number of workspaces per request, and the rest are
 *   searched by the pages after it.
 *
 * `score` and `documentId` are absent at the start of a workspace batch,
 * which is what `from` advancing without a keyset means.
 *
 * The encoding is base64url of JSON. It is opaque by contract: a client
 * passes back what it was given and reads nothing out of it, which is what
 * lets a later engine carry something else entirely.
 */

export type SearchArm = 'all' | 'any'

export interface SearchCursor {
  /** Where the workspace batch this page searched begins. */
  readonly from: number
  readonly arm: SearchArm
  /** The instant the first page's ranking was computed at, ISO 8601. */
  readonly at: string
  /** The last hit of the previous page, or null at the start of a workspace batch. */
  readonly keyset: { readonly score: number; readonly documentId: DocumentId } | null
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  const payload = {
    w: cursor.from,
    a: cursor.arm,
    t: cursor.at,
    ...(cursor.keyset === null ? {} : { s: cursor.keyset.score, d: cursor.keyset.documentId }),
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/**
 * The cursor a client handed back, or null when it is not one this build
 * wrote. A mangled cursor is never guessed at: the route refuses the request
 * rather than quietly answering a different question.
 */
export function decodeSearchCursor(value: string): SearchCursor | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof decoded !== 'object' || decoded === null) return null
    const { w, a, t, s, d } = decoded as Record<string, unknown>
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 0) return null
    if (a !== 'all' && a !== 'any') return null
    if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) return null

    const keyset = readKeyset(s, d)
    if (keyset === undefined) return null
    return { from: w, arm: a, at: t, keyset }
  } catch {
    return null
  }
}

/**
 * The keyset half, `null` when this page starts a workspace batch, and
 * `undefined` when what was carried is not a keyset at all — which is a
 * refusal, not a start.
 */
function readKeyset(
  score: unknown,
  documentId: unknown,
): { readonly score: number; readonly documentId: DocumentId } | null | undefined {
  if (score === undefined && documentId === undefined) return null
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined
  if (typeof documentId !== 'string' || documentId.length === 0) return undefined
  return { score, documentId: documentId as DocumentId }
}
