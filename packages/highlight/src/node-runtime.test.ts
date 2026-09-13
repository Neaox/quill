/**
 * Regression test for the real Node ESM runtime, not Vitest's module
 * interop (ADR-030, grammars.ts).
 *
 * `grammars.ts` imports "prismjs" — CommonJS with no static named exports
 * `cjs-module-lexer` can see — and Vitest's own CommonJS/ESM interop happens
 * to spread that namespace regardless of how it is imported, which hid a
 * real bug: under plain `node`, `import * as Prism from 'prismjs'` used to
 * yield `{ default, 'module.exports' }`, leaving `Prism.languages`
 * `undefined` and every `tokenize` call throwing. That broke `node
 * apps/server/src/main.ts` and the seed script while every Vitest run
 * stayed green, so only a test that spawns a real `node` process — the same
 * loader the server and the seed use — can catch a regression here.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

// Runs as a plain Node ESM entry point (via `node --input-type=module -e`),
// cwd'd to the repository root, so the relative specifier resolves exactly
// as it would from a script the server or the seed could write. It prints
// range counts rather than the ranges themselves so the test only has to
// parse one line of stdout.
const SCRIPT = `
import { tokenize } from './packages/highlight/src/index.ts'
const typescript = tokenize('const x: number = 1', 'typescript')
const json = tokenize('{"a": 1, "b": true}', 'json')
console.log(JSON.stringify({ typescript: typescript.length, json: json.length }))
`

describe('tokenize under plain Node ESM', () => {
  it('resolves the Prism runtime and tokenizes TypeScript and JSON into non-empty ranges', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)

    const counts = JSON.parse(result.stdout) as { typescript: number; json: number }
    expect(counts.typescript).toBeGreaterThan(0)
    expect(counts.json).toBeGreaterThan(0)
  })
})
