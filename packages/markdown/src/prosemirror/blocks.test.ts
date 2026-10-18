import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { planChunks } from '../pipeline/chunk-plan.ts'
import { createChunkSchedule } from '../pipeline/chunk-schedule.ts'
import { normaliseMarkdown } from '../pipeline/normalise.ts'
import { readChunk } from '../pipeline/parse-chunk.ts'
import type { ReadChunk } from '../pipeline/parse-chunk.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { blocksFromMdast } from './blocks.ts'
import type { NodeJson } from './blocks.ts'

/**
 * The editor blocks of a long paste are converted piece by piece in the
 * worker (quill-plan.md section 31); laid end to end they must be the blocks
 * of the whole document converted at once.
 */

const CORPUS = fileURLToPath(new URL('../../corpus/', import.meta.url))
const documents = readdirSync(CORPUS)
  .filter((file) => file.endsWith('.md'))
  .toSorted()
  .map((file) => readFileSync(`${CORPUS}${file}`, 'utf8'))

/** Every piece's blocks, in the order the schedule delivers them. */
function blocksInPieces(markdown: string, sizes: { first: number; rest: number }): NodeJson[] {
  const schedule = createChunkSchedule<ReadChunk>(planChunks(normaliseMarkdown(markdown), sizes))
  const blocks: NodeJson[] = []
  for (let job = schedule.next(); job !== undefined; job = schedule.next()) {
    for (const { payload } of schedule.settle(readChunk(job))) {
      blocks.push(...blocksFromMdast(payload.children))
    }
  }
  return blocks
}

describe('converting a paste to editor blocks', () => {
  it('drops front matter, and brings no empty paragraph for a piece with nothing in it', () => {
    expect(blocksFromMdast(parseMarkdown('---\ntitle: x\n---\n').children)).toEqual([])
    expect(blocksFromMdast(parseMarkdown('# Title\n').children)).toEqual([
      expect.objectContaining({ type: 'heading' }),
    ])
  })

  it('makes the same blocks piece by piece as from the whole document', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...documents), { minLength: 1, maxLength: 3 }),
        fc.record({
          first: fc.integer({ min: 1, max: 2_000 }),
          rest: fc.integer({ min: 1, max: 4_000 }),
        }),
        (joined, sizes) => {
          const markdown = joined.join('\n')
          expect(blocksInPieces(markdown, sizes)).toEqual(
            blocksFromMdast(parseMarkdown(markdown).children),
          )
        },
      ),
      { numRuns: 40 },
    )
  })
})
