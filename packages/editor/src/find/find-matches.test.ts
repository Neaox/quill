import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { findMatches } from './find-matches.ts'
import { compilePattern } from './find-pattern.ts'
import type { FindOptions } from './find-pattern.ts'

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)
const lines = (...rows: string[]) => rows.join(NL) + NL
const PLAIN: FindOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  preserveCase: false,
}

/** The words each match of `query` selects in `source`, and whether the search stopped short. */
function search(source: string, query: string, options: Partial<FindOptions> = {}, limit?: number) {
  const state = harness.state(source)
  const pattern = compilePattern(query, { ...PLAIN, ...options })
  if (pattern.kind !== 'ok') throw new Error(`The query is ${pattern.kind}.`)
  const found = findMatches(state.doc, pattern, undefined, limit)
  return {
    words: found.matches.map(({ from, to }) => state.doc.textBetween(from, to)),
    truncated: found.truncated,
    state,
    found,
  }
}

describe('finding in a document', () => {
  it('finds in every kind of block, and a match selects exactly its words', () => {
    const doc = lines(
      '# Plan one',
      '',
      'A plan, then another plan.',
      '',
      '- the plan',
      '',
      '| plan |',
      '| - |',
      '| a plan b |',
    )

    expect(search(doc, 'plan').words).toEqual(['Plan', 'plan', 'plan', 'plan', 'plan', 'plan'])
  })

  it('finds words split across marks as the one match they are', () => {
    const { words, found, state } = search('A **bo**ld claim.' + NL, 'bold')

    expect(words).toEqual(['bold'])
    expect(found.matches[0]?.to).toBe((found.matches[0]?.from ?? 0) + 4)
    expect(state.doc.textContent).toBe('A bold claim.')
  })

  it('does not run on from one block into the next', () => {
    expect(search(lines('end', '', 'start'), 'end start').words).toEqual([])
    expect(search(lines('end', '', 'start'), String.raw`d\ns`, { regex: true }).words).toEqual([])
  })

  it('leaves code blocks alone, and finds inline code', () => {
    const doc = lines('```', 'const plan = 1', '```', '', 'Say `plan` aloud')

    expect(search(doc, 'plan').words).toEqual(['plan'])
  })

  it('finds the words inside an inline element, and no match runs across its edge', () => {
    const doc = 'x :ok[Built] y' + NL

    expect(search(doc, 'Built').words).toEqual(['Built'])
    expect(search(doc, 'x Built').words).toEqual([])
    expect(search(doc, 'Built y').words).toEqual([])
  })

  it('treats an image or a line break as one character that nothing matches', () => {
    expect(search('a![alt](/x.png)b' + NL, 'ab').words).toEqual([])
    expect(search('a![alt](/x.png)b' + NL, 'a.b', { regex: true }).words).toEqual([])
  })

  it('finds only within the stretch it is given', () => {
    const state = harness.state(lines('plan one', '', 'plan two', '', 'plan three'))
    const pattern = compilePattern('plan', PLAIN)
    if (pattern.kind !== 'ok') throw new Error('Not ok.')
    const all = findMatches(state.doc, pattern)
    const second = all.matches[1]
    if (second === undefined) throw new Error('No second match.')

    const within = findMatches(state.doc, pattern, { from: second.from - 1, to: second.to + 4 })

    expect(within.matches).toEqual([second])
    expect(within.matches[0]?.captured[0]).toBe('plan')
  })

  it('stops at its limit, and says it did', () => {
    const doc = lines('plan plan plan plan plan')

    expect(search(doc, 'plan', {}, 3)).toMatchObject({
      words: ['plan', 'plan', 'plan'],
      truncated: true,
    })
    expect(search(doc, 'plan', {}, 5).truncated).toBe(false)
  })

  it('finds nothing in an empty document', () => {
    expect(search('' + NL, 'plan').words).toEqual([])
  })
})
