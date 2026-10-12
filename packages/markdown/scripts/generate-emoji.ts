/**
 * Writes `src/emoji/shortcodes.gen.ts`, GitHub's emoji shortcodes as a compact
 * table (`src/emoji/generate.ts` says why it is generated).
 *
 * Usage: `pnpm --filter @quill/markdown generate:emoji`.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { gemoji } from 'gemoji'

import { shortcodeModule } from '../src/emoji/generate.ts'

const target = new URL('../src/emoji/shortcodes.gen.ts', import.meta.url)
writeFileSync(fileURLToPath(target), shortcodeModule(gemoji), 'utf8')
process.stdout.write('wrote src/emoji/shortcodes.gen.ts\n')
