import type { DocumentMerge } from '@quill/markdown'
import type { MergeRequest, MergeResponse } from '@quill/markdown/merge-worker'

import type { DocumentAst } from './clients.ts'
import type { MergeRunner } from './use-draft-reconciliation.ts'
import { mergeOnThisThread } from './use-draft-reconciliation.ts'

/**
 * Where a reconnecting editor's three-way merge runs (ADR-021, amendment of
 * 2026-10-11: "large documents merge in a worker").
 *
 * A port with two adapters, like the paste parser (`document/markdown-parser.ts`):
 * the page, for an ordinary document, where a merge takes a few milliseconds
 * and a worker's start-up and copying would cost more; a module worker for a
 * long one, so the tab keeps answering keystrokes while it merges. A worker
 * that cannot be built, or dies, hands its merges back to the page.
 */

/** Documents with more top-level blocks than this, on any side, merge in the worker. */
export const WORKER_BLOCKS = 400

/** The slice of a `Worker` the runner uses. */
export interface MergeWorkerLike {
  postMessage(request: MergeRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<MergeResponse>) => void): void
  addEventListener(type: 'error', listener: () => void): void
  terminate(): void
}

interface Waiting {
  readonly base: DocumentAst
  readonly mine: DocumentAst
  readonly theirs: DocumentAst
  resolve(merge: Promise<DocumentMerge>): void
}

/** Merges in a worker built on first use, falling back to the page on any failure. */
export function workerMergeRunner(create: () => MergeWorkerLike): MergeRunner {
  const waiting = new Map<number, Waiting>()
  let worker: MergeWorkerLike | undefined
  let next = 0

  const started = (): MergeWorkerLike => {
    const made = create()
    made.addEventListener('message', ({ data }) => {
      waiting.get(data.id)?.resolve(Promise.resolve(data.merge))
      waiting.delete(data.id)
    })
    made.addEventListener('error', () => {
      made.terminate()
      worker = undefined
      for (const [id, request] of waiting) {
        waiting.delete(id)
        request.resolve(mergeOnThisThread(request.base, request.mine, request.theirs))
      }
    })
    return made
  }

  return (base, mine, theirs) => {
    try {
      worker ??= started()
    } catch {
      return mergeOnThisThread(base, mine, theirs)
    }
    const id = next++
    const { promise, resolve } = Promise.withResolvers<DocumentMerge>()
    waiting.set(id, { base, mine, theirs, resolve: (merge) => void merge.then(resolve) })
    // A worker's postMessage has no target origin; the rule is about windows.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    worker.postMessage({ id, base, mine, theirs })
    return promise
  }
}

/** The page's runner: the page for ordinary documents, the worker for long ones. */
export function sizedMergeRunner(large: MergeRunner): MergeRunner {
  return (base, mine, theirs) =>
    Math.max(base.children.length, mine.children.length, theirs.children.length) > WORKER_BLOCKS
      ? large(base, mine, theirs)
      : mergeOnThisThread(base, mine, theirs)
}

/** The module worker, written the way the bundler recognises and splits into its own chunk. */
function createMergeWorker(): MergeWorkerLike {
  return new Worker(new URL('./merge.worker.ts', import.meta.url), { type: 'module' })
}

let page: MergeRunner | undefined

/** One merge worker for the page, made the first time a long document needs it. */
export function pageMergeRunner(): MergeRunner {
  if (typeof Worker === 'undefined') return mergeOnThisThread
  page ??= sizedMergeRunner(workerMergeRunner(createMergeWorker))
  return page
}
