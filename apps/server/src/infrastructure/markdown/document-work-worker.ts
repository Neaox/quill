import { parentPort } from 'node:worker_threads'

import type { RenderInput } from '@quill/application'

import { createDocumentFormat } from './document-format.ts'

/**
 * One thread of the document work pool (`document-work-pool.ts`): its own
 * copy of the document format, built as the server's composition root builds
 * it, answering one item at a time. It announces the format's extension
 * signature first, so the pool can refuse a thread whose renderer is not the
 * one the server keys its cache by.
 */

/** What the pool asks a thread to do. */
export type DocumentTask =
  | { readonly id: number; readonly kind: 'inspect'; readonly item: string }
  | { readonly id: number; readonly kind: 'render'; readonly item: RenderInput }

/* v8 ignore start -- runs in a worker thread, which coverage does not follow; the pool's tests drive it end to end. */
const port = parentPort
if (port === null) throw new Error('The document work worker runs only in a worker thread.')

const format = createDocumentFormat()

port.on('message', (task: DocumentTask) => {
  try {
    const value = task.kind === 'inspect' ? format.inspect(task.item) : format.render(task.item)
    port.postMessage({ id: task.id, value })
  } catch (error) {
    port.postMessage({ id: task.id, error: error instanceof Error ? error.message : String(error) })
  }
})

port.postMessage({ ready: format.extensions ?? '' })
/* v8 ignore stop */
