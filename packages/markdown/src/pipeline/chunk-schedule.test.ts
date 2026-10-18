import { describe, expect, it } from 'vitest'

import { planChunks } from './chunk-plan.ts'
import { createChunkSchedule } from './chunk-schedule.ts'
import type { ChunkDefinition, ChunkJob, ChunkSchedule } from './chunk-schedule.ts'

/**
 * The schedule as a reducer: jobs out, results in, final pieces delivered in
 * order. The parser here is a stand-in that reports what the test says, so
 * each rule is exercised without parsing anything.
 */

const EVERYWHERE = { first: 1, rest: 1 }

interface Fake {
  readonly definitions?: readonly ChunkDefinition[]
  readonly endsOpen?: boolean
}

function settle(
  schedule: ChunkSchedule<string>,
  job: ChunkJob,
  fake: Fake = {},
): readonly string[] {
  return schedule
    .settle({
      id: job.id,
      definitions: fake.definitions ?? [],
      endsOpen: fake.endsOpen ?? false,
      payload: job.text,
    })
    .map((delivery) => delivery.payload)
}

function jobs(schedule: ChunkSchedule<string>): ChunkJob[] {
  const out: ChunkJob[] = []
  for (let job = schedule.next(); job !== undefined; job = schedule.next()) out.push(job)
  return out
}

describe('the chunk schedule', () => {
  it('parses every piece once, in order, and delivers each as soon as those before it are', () => {
    const schedule = createChunkSchedule<string>(planChunks('A.\n\nB.\n\nC.\n', EVERYWHERE))
    const [a, b, c] = jobs(schedule)
    if (a === undefined || b === undefined || c === undefined) throw new Error('Three jobs.')
    expect([a.offset, b.offset, c.offset]).toEqual([0, 4, 8])
    expect(settle(schedule, b)).toEqual([])
    expect(settle(schedule, a)).toEqual(['A.\n\n', 'B.\n\n'])
    expect(schedule.finished).toBe(false)
    expect(settle(schedule, c)).toEqual(['C.\n'])
    expect(schedule.finished).toBe(true)
  })

  it('reports how far through the document it has delivered', () => {
    const schedule = createChunkSchedule<string>(planChunks('A.\n\nB.\n', EVERYWHERE))
    const [a] = jobs(schedule)
    if (a === undefined) throw new Error('A job.')
    const [delivery] = schedule.settle({ id: a.id, definitions: [], endsOpen: false, payload: '' })
    expect(delivery?.progress).toBeCloseTo(4 / 7)
  })

  it('joins a piece that ran on to the next and parses them again together', () => {
    const schedule = createChunkSchedule<string>(planChunks('A.\n\nB.\n\nC.\n', EVERYWHERE))
    const [a, b, c] = jobs(schedule)
    if (a === undefined || b === undefined || c === undefined) throw new Error('Three jobs.')
    expect(settle(schedule, a, { endsOpen: true })).toEqual([])
    // B's own parse is no longer wanted; A and B go again as one.
    expect(settle(schedule, b)).toEqual([])
    const joined = schedule.next()
    expect(joined?.text).toBe('A.\n\nB.\n\n')
    expect(settle(schedule, c)).toEqual([])
    if (joined === undefined) throw new Error('A joined job.')
    expect(settle(schedule, joined)).toEqual(['A.\n\nB.\n\n', 'C.\n'])
  })

  it('lets the last piece run to the end, which is where the document ends', () => {
    const schedule = createChunkSchedule<string>(planChunks('A.\n\nB\n```\ncode\n', EVERYWHERE))
    const [a, b] = jobs(schedule)
    if (a === undefined || b === undefined) throw new Error('Two jobs.')
    settle(schedule, a)
    expect(settle(schedule, b, { endsOpen: true })).toEqual(['B\n```\ncode\n'])
  })

  it('parses a piece that mentions a definition from elsewhere again beside it, once all are known', () => {
    // A piece starts with a paragraph or heading, so the definition is quoted.
    const source = 'See [a].\n\nMiddle.\n\nLast.\n[a]: /x\n'
    const schedule = createChunkSchedule<string>(planChunks(source, EVERYWHERE))
    const [first, middle, last] = jobs(schedule)
    if (first === undefined || middle === undefined || last === undefined) {
      throw new Error('Three jobs.')
    }
    // The first piece borrows: its own parse is not final.
    expect(settle(schedule, first)).toEqual([])
    expect(settle(schedule, middle)).toEqual([])
    expect(
      settle(schedule, last, { definitions: [{ label: 'a', footnote: false, depth: 0 }] }),
    ).toEqual([])
    const beside = schedule.next()
    // The first piece may start with front matter, so the definition goes after it.
    expect(beside).toEqual({
      id: expect.any(Number),
      text: 'See [a].\n\n\n[a]: x\n',
      line: 0,
      offset: 0,
      borrowed: { before: 0, after: 1 },
      blankLinesBefore: undefined,
    })
    if (beside === undefined) throw new Error('A job beside the definition.')
    expect(settle(schedule, beside)).toEqual([
      'See [a].\n\n\n[a]: x\n',
      'Middle.\n\n',
      'Last.\n[a]: /x\n',
    ])
  })

  it('writes a borrowed definition before a later piece, and moves its lines and offsets back', () => {
    const source = '[^n]: The note.\n\nMiddle.\n\nNote[^n].\n'
    const schedule = createChunkSchedule<string>(planChunks(source, EVERYWHERE))
    const [first, middle, last] = jobs(schedule)
    if (first === undefined || middle === undefined || last === undefined) {
      throw new Error('Three jobs.')
    }
    settle(schedule, first, { definitions: [{ label: 'n', footnote: true, depth: 0 }] })
    settle(schedule, middle)
    settle(schedule, last)
    expect(schedule.next()).toEqual({
      id: expect.any(Number),
      text: '[^n]: x\n\nNote[^n].\n',
      line: 4 - 2,
      offset: source.indexOf('Note') - '[^n]: x\n\n'.length,
      borrowed: { before: 1, after: 0 },
      blankLinesBefore: 1,
    })
  })

  it('takes a piece that only looked like it borrowed as final once nothing is found to borrow', () => {
    // A definition cannot interrupt a paragraph, so this one is prose.
    const source = 'See [a].\n\nProse\n[a]: not a definition.\n'
    const schedule = createChunkSchedule<string>(planChunks(source, EVERYWHERE))
    const [first, last] = jobs(schedule)
    if (first === undefined || last === undefined) throw new Error('Two jobs.')
    settle(schedule, first)
    expect(settle(schedule, last)).toEqual(['See [a].\n\n', 'Prose\n[a]: not a definition.\n'])
    expect(schedule.next()).toBeUndefined()
    expect(schedule.finished).toBe(true)
  })

  it('counts a blank line of spaces as the blank line it is', () => {
    const schedule = createChunkSchedule<string>(planChunks('A.\n  \n\nB.\n', EVERYWHERE))
    const [, b] = jobs(schedule)
    expect(b?.blankLinesBefore).toBe(2)
  })

  it('goes on to the next piece that borrows when one finds nothing to borrow', () => {
    // The first piece borrows a real definition; the second only looked as if it would.
    const source = 'See [b].\n\nSee [a].\n\nLast.\n\n> [b]: /b\n\nProse\n[a]: not a definition.\n'
    const schedule = createChunkSchedule<string>(planChunks(source, EVERYWHERE))
    const alone = jobs(schedule)
    for (const job of alone) {
      settle(
        schedule,
        job,
        job.text.includes('[b]: /b')
          ? { definitions: [{ label: 'b', footnote: false, depth: 0 }] }
          : {},
      )
    }
    const beside = jobs(schedule)
    expect(beside.map((job) => job.text)).toEqual(['See [b].\n\n\n[b]: x\n'])
  })

  it('ignores a result it did not ask for', () => {
    const schedule = createChunkSchedule<string>(planChunks('A.\n', EVERYWHERE))
    expect(schedule.settle({ id: 99, definitions: [], endsOpen: false, payload: '' })).toEqual([])
  })
})
