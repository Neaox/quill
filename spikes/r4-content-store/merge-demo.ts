/**
 * Question 5: three-way merge of Markdown — library or shell out?
 *
 *   node merge-demo.ts
 *
 * Compares node-diff3 (pure JS), diff3 (the library nodegit's authors wrote),
 * and `git merge-file` (shelling out), on the two cases ADR-015 cares about:
 * two non-overlapping edits, and two edits to the same lines.
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { mergeMarkdown } from './src/content-store.ts'

const require = createRequire(import.meta.url)
const diff3lib = require('diff3')

const BASE = `---
id: doc_000042
title: Deploying Quill
---

# Deploying Quill

Quill runs as two processes: an API server and a static web bundle.

## Prerequisites

You need Node 24 and a Postgres 16 database.

## Steps

1. Copy \`.env.example\` to \`.env\`.
2. Run the migrations.
3. Start the server.

## Troubleshooting

If the server will not start, check the database URL.
`

// Ada rewrites the prerequisites. Ben adds a troubleshooting note.
const ADA = BASE.replace(
  'You need Node 24 and a Postgres 16 database.',
  'You need Node 24, pnpm 11, and a Postgres 16 database reachable from the API server.',
)
const BEN = BASE.replace(
  'If the server will not start, check the database URL.',
  'If the server will not start, check the database URL.\nIf migrations fail, check that the database user can create extensions.',
)

// Both rewrite the same step.
const ADA_C = BASE.replace('3. Start the server.', '3. Run `pnpm start` to start the server.')
const BEN_C = BASE.replace('3. Start the server.', '3. Start the server with `quill serve`.')

function cliMerge(base: string, ours: string, theirs: string): { ok: boolean; text: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-merge-'))
  fs.writeFileSync(path.join(dir, 'base'), base)
  fs.writeFileSync(path.join(dir, 'ours'), ours)
  fs.writeFileSync(path.join(dir, 'theirs'), theirs)
  try {
    const out = execFileSync(
      'git',
      [
        'merge-file',
        '-p',
        '--diff3',
        '-L',
        'yours',
        '-L',
        'base',
        '-L',
        'published',
        'ours',
        'base',
        'theirs',
      ],
      { cwd: dir, encoding: 'utf8' },
    )
    return { ok: true, text: out }
  } catch (e) {
    const err = e as { stdout?: string }
    return { ok: false, text: err.stdout ?? '' }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function time(label: string, runs: number, f: () => void): number {
  f() // warm
  const t = performance.now()
  for (let i = 0; i < runs; i++) f()
  const ms = (performance.now() - t) / runs
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(3)} ms/merge`)
  return ms
}

console.log('=== case 1: two non-overlapping edits ===')
const clean = mergeMarkdown(BASE, ADA, BEN)
console.log(`node-diff3       conflicts=${clean.conflicts} ok=${clean.ok}`)
console.log(`  kept Ada's edit:  ${clean.text.includes('pnpm 11')}`)
console.log(`  kept Ben's edit:  ${clean.text.includes('create extensions')}`)
const cleanCli = cliMerge(BASE, ADA, BEN)
console.log(`git merge-file   ok=${cleanCli.ok}`)
console.log(`  byte-identical to git merge-file: ${cleanCli.text === clean.text}`)
const cleanLib = diff3lib(ADA.split('\n'), BASE.split('\n'), BEN.split('\n'))
console.log(
  `diff3 (0.0.4)    regions=${cleanLib.length} conflicts=${cleanLib.filter((r: { conflict?: unknown }) => r.conflict).length}`,
)

console.log('\n=== case 2: both edit the same line ===')
const conflicted = mergeMarkdown(BASE, ADA_C, BEN_C)
console.log(`node-diff3       conflicts=${conflicted.conflicts} ok=${conflicted.ok}`)
const conflictedCli = cliMerge(BASE, ADA_C, BEN_C)
console.log(`git merge-file   ok=${conflictedCli.ok} (non-zero exit = conflict)`)
console.log('\nnode-diff3 conflict region:')
console.log(
  conflicted.text
    .split('\n')
    .filter((_, i, a) => {
      const s = a.findIndex((l) => l.startsWith('<<<<<<<'))
      const e = a.findIndex((l) => l.startsWith('>>>>>>>'))
      return i >= s && i <= e
    })
    .map((l) => `  | ${l}`)
    .join('\n'),
)
console.log('\ngit merge-file conflict region:')
console.log(
  conflictedCli.text
    .split('\n')
    .filter((_, i, a) => {
      const s = a.findIndex((l) => l.startsWith('<<<<<<<'))
      const e = a.findIndex((l) => l.startsWith('>>>>>>>'))
      return i >= s && i <= e
    })
    .map((l) => `  | ${l}`)
    .join('\n'),
)

console.log('\n=== case 3: both append different lines at the end of the same section ===')
const adaEnd = `${BASE}\n## See also\n\n- The operations runbook.\n`
const benEnd = `${BASE}\n## See also\n\n- The security policy.\n`
const endMerge = mergeMarkdown(BASE, adaEnd, benEnd)
const endCli = cliMerge(BASE, adaEnd, benEnd)
console.log(`node-diff3 conflicts=${endMerge.conflicts}  git merge-file ok=${endCli.ok}`)
console.log('  (adjacent-append is a genuine conflict for both — line diff cannot tell them apart)')

console.log('\n=== cost ===')
time('node-diff3 (in process)', 2000, () => mergeMarkdown(BASE, ADA, BEN))
time('diff3 0.0.4 (in process)', 2000, () =>
  diff3lib(ADA.split('\n'), BASE.split('\n'), BEN.split('\n')),
)
time('git merge-file (spawn + 3 temp files)', 50, () => cliMerge(BASE, ADA, BEN))

console.log('\n=== 200 KB document ===')
const big = Array.from({ length: 4000 }, (_, i) => `Line ${i} of a long document.`).join('\n')
const bigA = big.replace('Line 10 of', 'Line ten of')
const bigB = big.replace('Line 3900 of', 'Line three thousand nine hundred of')
const r = mergeMarkdown(big, bigA, bigB)
console.log(`  conflicts=${r.conflicts}, merged length=${r.text.length}`)
time('node-diff3 on 4000 lines', 100, () => mergeMarkdown(big, bigA, bigB))
