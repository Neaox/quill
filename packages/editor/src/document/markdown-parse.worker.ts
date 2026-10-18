import type { ChunkJob } from '@quill/markdown/chunks'
import { characterEntities } from 'character-entities'

import type { ChunkResponse } from './paste-chunk.ts'
import { standInForDocument } from './worker-document.ts'

/**
 * The module worker the pieces of a large paste are parsed and converted in
 * (`markdown-parser.ts`). It answers each piece it is given with the piece's
 * editor blocks, in the order the pieces came.
 *
 * The parse pipeline is loaded while the worker has its stand-in document,
 * which the pipeline looks for as it loads (`worker-document.ts`); the
 * stand-in is then taken away before the converter loads, so the converter's
 * schema never mistakes the worker for a page. A piece that arrives before
 * all of that has loaded waits for it, in order, and a worker that cannot
 * load says so for every piece, which the page then parses itself.
 */
const remove = standInForDocument(globalThis, characterEntities)
const answering = import('@quill/markdown/parse-chunk')
  .finally(remove)
  .then(async () => import('./paste-chunk.ts'))

addEventListener('message', (event: MessageEvent<ChunkJob>) => {
  const job = event.data
  void answering.then(
    ({ answerChunk }) => {
      postMessage(answerChunk(job))
    },
    (error: unknown) => {
      const response: ChunkResponse = { id: job.id, error: String(error) }
      postMessage(response)
    },
  )
})
