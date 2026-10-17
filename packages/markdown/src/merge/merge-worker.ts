import type { Root } from 'mdast'

import type { DocumentMerge } from './merge-documents.ts'
import { mergeDocuments } from './merge-documents.ts'

/**
 * The merge, off the main thread (ADR-021: "large documents merge in a
 * worker"). A web app's worker module is two lines — import `serveMerges`
 * and hand it the worker's global scope — and its main thread posts a
 * `MergeRequest` and waits for the `MergeResponse` with the same id.
 *
 * The message protocol lives here, beside the engine, so the two sides of it
 * cannot drift: the page and the worker both import these types.
 */

export interface MergeRequest {
  readonly id: number
  readonly base: Root
  readonly mine: Root
  readonly theirs: Root
}

export interface MergeResponse {
  readonly id: number
  readonly merge: DocumentMerge
}

/** The slice of a worker's global scope this needs; a fake one in tests. */
export interface MergeWorkerScope {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  postMessage(message: MergeResponse): void
}

function isRoot(value: unknown): value is Root {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'root' &&
    'children' in value &&
    Array.isArray(value.children)
  )
}

export function isMergeRequest(value: unknown): value is MergeRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    'base' in value &&
    isRoot(value.base) &&
    'mine' in value &&
    isRoot(value.mine) &&
    'theirs' in value &&
    isRoot(value.theirs)
  )
}

export function answerMergeRequest(request: MergeRequest): MergeResponse {
  return { id: request.id, merge: mergeDocuments(request.base, request.mine, request.theirs) }
}

/** Answers every merge request posted to `scope`; anything else is ignored. */
export function serveMerges(scope: MergeWorkerScope): void {
  scope.addEventListener('message', ({ data }) => {
    // A dedicated worker takes no target origin (its second argument is a transfer list);
    // the rule is written for `window.postMessage`.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    if (isMergeRequest(data)) scope.postMessage(answerMergeRequest(data))
  })
}
