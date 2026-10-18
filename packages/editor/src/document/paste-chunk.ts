import { blocksFromMdast } from '@quill/markdown/blocks'
import type { NodeJson } from '@quill/markdown/blocks'
import type { ChunkJob, ChunkResult } from '@quill/markdown/chunks'
import { readChunk } from '@quill/markdown/parse-chunk'

/**
 * One piece of a large paste, parsed and converted to the editor's blocks
 * (quill-plan.md section 31): what the parse worker does with each request
 * (`markdown-parse.worker.ts`), and what the page does itself when there is
 * no worker to ask (`markdown-parser.ts`).
 */

/** A piece's blocks as editor JSON, which the page turns into nodes with `Node.fromJSON`. */
export type PasteBlocks = readonly NodeJson[]

export type ChunkResponse =
  | { readonly id: number; readonly result: ChunkResult<PasteBlocks> }
  | { readonly id: number; readonly error: string }

/** Parses and converts one piece, or says why it could not, rather than throwing. */
export function answerChunk(job: ChunkJob): ChunkResponse {
  try {
    const read = readChunk(job)
    return { id: job.id, result: { ...read, payload: blocksFromMdast(read.payload.children) } }
  } catch (error) {
    return { id: job.id, error: String(error) }
  }
}
