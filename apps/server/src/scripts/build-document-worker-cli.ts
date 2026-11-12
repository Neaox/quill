/**
 * Writes `@quill/format`'s `dist/document-work-worker.mjs`, the document work
 * pool's thread as one built module (`document-work-bundle.ts`).
 *
 * Usage: part of `pnpm --filter @quill/server build`.
 */
import { BUILT_DOCUMENT_WORKER } from '@quill/format'
import { buildDocumentWorker } from '@quill/format/build'

await buildDocumentWorker()
process.stdout.write(`wrote ${BUILT_DOCUMENT_WORKER.pathname}\n`)
