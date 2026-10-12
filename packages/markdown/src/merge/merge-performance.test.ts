// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { parseMarkdown } from '../pipeline/processor.ts'
import { mergeDocuments } from './merge-documents.ts'

/**
 * ADR-021's budget for the merge: a 4,000-line document merges in under
 * 100 ms, in the browser's environment (jsdom here), so a reconnect never
 * holds the editor up. Measured on trees already parsed, which is what the
 * editor has; the median of several runs, each over fresh trees, so no key
 * computed in one run is cached for the next.
 */

// jsdom serves modules over http, so the corpus is found from the file's own directory.
const CORPUS = `${resolve(import.meta.dirname, '../../corpus')}/`
const LINES = 4000
const BUDGET_MS = 100
const RUNS = 5

/** The corpus, repeated under numbered parts, until it is at least 4,000 lines long. */
function longDocument(): string {
  const files = readdirSync(CORPUS)
    .filter((file) => file.endsWith('.md'))
    .toSorted()
    .map((file) => readFileSync(`${CORPUS}${file}`, 'utf8').replace(/^---\n[\s\S]*?\n---\n/u, ''))
  const parts: string[] = []
  for (let part = 0; parts.join('\n').split('\n').length < LINES; part += 1) {
    parts.push(`# Part ${part}\n\n${files[part % files.length] ?? ''}`)
  }
  return parts.join('\n')
}

/** The source with its `n`th occurrence of `find` replaced. */
function replaceNth(source: string, find: string, replacement: string, n: number): string {
  let index = -1
  for (let seen = 0; seen <= n; seen += 1) index = source.indexOf(find, index + 1)
  return index === -1
    ? source
    : `${source.slice(0, index)}${replacement}${source.slice(index + find.length)}`
}

describe('merge performance', () => {
  const base = longDocument()
  // Mine edits near the top and adds a section; theirs edits further down.
  const mine = `${replaceNth(replaceNth(base, 'the ', 'THE ', 3), ' a ', ' A ', 200)}\n# Added by mine\n\nNew words.\n`
  const theirs = replaceNth(replaceNth(base, 'the ', 'that ', 400), ' a ', ' an ', 230)

  it(`merges a ${LINES}-line document in under ${BUDGET_MS} ms`, () => {
    expect(base.split('\n').length).toBeGreaterThanOrEqual(LINES)
    const timings: number[] = []
    let result: ReturnType<typeof mergeDocuments> | undefined
    for (let run = 0; run < RUNS; run += 1) {
      const trees: [Root, Root, Root] = [
        parseMarkdown(base),
        parseMarkdown(mine),
        parseMarkdown(theirs),
      ]
      const started = performance.now()
      result = mergeDocuments(...trees)
      timings.push(performance.now() - started)
    }
    const median = timings.toSorted((left, right) => left - right)[Math.floor(RUNS / 2)] ?? Infinity
    process.stdout.write(
      `merge of ${base.split('\n').length} lines: median ${median.toFixed(1)} ms over ${timings.map((t) => t.toFixed(1)).join(', ')}\n`,
    )
    expect(result?.conflicts).toEqual([])
    expect(median).toBeLessThan(BUDGET_MS)
  })
})
