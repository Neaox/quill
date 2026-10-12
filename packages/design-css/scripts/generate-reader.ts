/**
 * Writes `src/reader/reader.gen.js`, the public site's reader script
 * (`src/reader/bundle.ts` says why it is generated).
 *
 * Usage: `pnpm --filter @quill/design-css generate:reader`.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { bundleReaderScript, READER_SCRIPT_FILE } from '../src/reader/bundle.ts'

writeFileSync(
  fileURLToPath(new URL(`../src/reader/${READER_SCRIPT_FILE}`, import.meta.url)),
  await bundleReaderScript(),
  'utf8',
)
process.stdout.write(`wrote src/reader/${READER_SCRIPT_FILE}\n`)
