/**
 * Writes the generated stylesheets (ADR-028, ADR-030) into `src/styles`.
 *
 * Usage: `pnpm --filter @quill/ui generate:tokens`.
 *
 * The arrangement lives in `src/styles/generated-css.ts` so the test suite can
 * regenerate and compare without shelling out; this file is only the part that
 * touches the file system.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generatedStylesheets } from '../src/styles/generated-css.ts'

const stylesDirectory = new URL('../src/styles/', import.meta.url)

for (const { path, css } of generatedStylesheets()) {
  const file = fileURLToPath(new URL(path, stylesDirectory))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, css, 'utf8')
  process.stdout.write(`wrote src/styles/${path}\n`)
}
