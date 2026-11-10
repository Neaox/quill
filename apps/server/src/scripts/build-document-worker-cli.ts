/**
 * Writes `dist/document-work-worker.mjs`, the document work pool's thread as
 * one built module (`infrastructure/markdown/document-work-bundle.ts`).
 *
 * Usage: part of `pnpm --filter @quill/server build`.
 */
import { buildDocumentWorker } from '../infrastructure/markdown/document-work-bundle.ts'
import { BUILT_DOCUMENT_WORKER } from '../infrastructure/markdown/document-work-pool.ts'

await buildDocumentWorker()
process.stdout.write(`wrote ${BUILT_DOCUMENT_WORKER.pathname}\n`)
